import { regulationDispatch } from "../_lib/regulations.js";
import { isLspdPermission, isFIBClassificationKey } from "../_lib/lspd-permission-boundary.js";
import { config, db, dbCount, json, readJson, rpc } from "../_lib/supabase.js";
import { SHEET_BACKED_METHODS, googleSheetsCall } from "../_lib/google-sheets.js";
import { bearer, clearAuthCaches, createSession, getPermissions, publicUser, requireSession, sha256, verifyPassword } from "../_lib/auth.js";
const bad=(message,status=400,code)=>json({success:false,message,...(code?{code}:{})},status);
const dashboardStatsCache=new Map();
const dashboardQueryCache=new Map();
let dashboardStatsEpoch=0;
const text=v=>String(v??"").trim();
const id=prefix=>prefix+crypto.randomUUID().replace(/-/g,"").slice(0,14).toUpperCase();
async function authz(env,token,permission){
  const auth=await requireSession(env,token);
  if(!auth)throw Object.assign(new Error("Deine Sitzung ist abgelaufen. Bitte erneut anmelden."),{status:401});
  const p=await getPermissions(env,auth.user);
  const hasRankPermission=auth.user.master===true||p.permissions.includes("*")||!permission||p.permissions.includes(permission);
  if(!hasRankPermission)throw Object.assign(new Error("Du besitzt nicht die erforderliche Berechtigung."),{status:403});
  const departmentScoped=permission && Array.isArray(p.departmentScopedPermissions) && p.departmentScopedPermissions.includes(permission);
  if(auth.user.master!==true&&departmentScoped&&!p.departmentPermissions.includes(permission))throw Object.assign(new Error(`Deine Abteilung „${p.department||"nicht zugeordnet"}“ ist für diese Berechtigung nicht freigeschaltet.`),{status:403});
  return {...auth,master:auth.user.master===true,permissions:p.permissions,department:p.department||"",departmentPermissions:p.departmentPermissions||[],departmentScopedPermissions:p.departmentScopedPermissions||[]};
}
async function has(env,auth,perm){return auth.master||auth.permissions.includes("*")||auth.permissions.includes(perm)}
async function rankRows(env){return await db(env,"ranks",{query:{select:"id,name,short_name,level,active",order:"level.desc"}})}
async function permissionsFor(env,auth){return {master:auth.master,permissions:auth.permissions,department:auth.department||"",departmentPermissions:auth.departmentPermissions||[],departmentScopedPermissions:auth.departmentScopedPermissions||[]}}
async function handleAuth(path,request,env,payload){const args=Array.isArray(payload.args)?payload.args:[];const token=bearer(request,payload);
 if(path==="login"){const username=text(args[0]),password=String(args[1]??"");if(!username||!password)return bad("Benutzername und Passwort erforderlich.");const rows=await db(env,"users",{query:{select:"id,username,name,rank,password_salt,password_hash,active,approved,master,profile_image",username:`ilike.${username.replace(/[%,_*]/g," ")}`,limit:"1"}});const u=Array.isArray(rows)?rows[0]:null;if(!u||!(await verifyPassword(password,u.password_salt,u.password_hash)))return bad("Benutzername oder Passwort ist falsch.",401,"INVALID_CREDENTIALS");if(u.approved!==true)return bad("Dieser Account wartet noch auf die Freigabe durch einen Master.",403,"ACCOUNT_PENDING");if(u.active!==true)return bad("Dieser Benutzer ist deaktiviert.",403,"ACCOUNT_DISABLED");const sess=await createSession(env,u.id);await writeAudit(env,{user:{id:u.id,name:u.name}},"login","authentication",u.id,"Anmeldung erfolgreich");return json({success:true,token:sess.token,expiresAt:sess.expiresAt,user:await publicUser(env,u)});}
 if(path==="register"){const username=text(args[0]),name=text(args[1]),password=String(args[2]??"");if(!username||!name||!password)return bad("Benutzername, Name und Passwort sind erforderlich.");if(!/^[A-Za-z0-9]+$/.test(username))return bad("Der Benutzername darf ausschließlich Buchstaben und Zahlen enthalten. Sonderzeichen, Leerzeichen und Umlaute sind nicht erlaubt.");if(password.length<8)return bad("Das Passwort muss mindestens 8 Zeichen lang sein.");const existing=await db(env,"users",{query:{select:"id",username:`ilike.${username.replace(/[%,_*]/g," ")}`,limit:"1"}});if(existing?.length)return bad("Dieser Benutzername existiert bereits.",409);const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");await db(env,"users",{method:"POST",body:{id:id("U"),username,name,rank:null,password_salt:salt,password_hash:await sha256(salt+password),active:false,approved:false,master:false,profile_image:null,created_at:new Date().toISOString()},prefer:"return=minimal"});return json({success:true,message:"Der Account wurde beantragt und muss durch einen Master freigegeben werden."});}
 if(path==="session"){const a=await requireSession(env,args[0]||token);return a?json(await publicUser(env,a.user)):bad("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.",401);}
 if(path==="session-info"){const a=await requireSession(env,args[0]||token);return a?json({success:true,user:await publicUser(env,a.user),expiresAt:a.session.expires_at}):bad("Sitzung abgelaufen.",401);}
 if(path==="permissions"){const a=await authz(env,args[0]||token);return json(await permissionsFor(env,a));}
 if(path==="logout"){const t=String(args[0]||token||"");const actor=t?await requireSession(env,t):null;if(t)await db(env,"fib_mdt_sessions",{method:"DELETE",query:{token_hash:`eq.${await sha256(t)}`},prefer:"return=minimal"});clearAuthCaches();if(actor)await writeAudit(env,actor,"logout","authentication",actor.user.id,"Abmeldung");return json({success:true});}
 if(path==="password"){const t=String(args[0]||token),current=String(args[1]??""),next=String(args[2]??"");const a=await authz(env,t);if(!current||!next)return bad("Aktuelles und neues Passwort sind erforderlich.");if(next.length<8)return bad("Das neue Passwort muss mindestens 8 Zeichen lang sein.");const rows=await db(env,"users",{query:{select:"password_salt,password_hash",id:`eq.${a.user.id}`,limit:"1"}});const u=rows?.[0];if(!u||!(await verifyPassword(current,u.password_salt,u.password_hash)))return bad("Das aktuelle Passwort ist falsch.",403);const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");await db(env,"users",{method:"PATCH",query:{id:`eq.${a.user.id}`},body:{password_salt:salt,password_hash:await sha256(salt+next),updated_at:new Date().toISOString()},prefer:"return=minimal"});await writeAudit(env,a,"password_change","authentication",a.user.id,"Eigenes Passwort geändert");return json({success:true,message:"Passwort geändert."});}
 if(path==="profile-image") {
  const a=await authz(env,args[0]||token); const dataUrl=String(args[1]||""); const fileName=String(args[2]||"profile");
  const m=dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if(!m) return bad("Bitte eine PNG-, JPEG- oder WebP-Datei auswählen.");
  const mime=m[1].toLowerCase(); const raw=m[2];
  if(raw.length>2800000) return bad("Das Profilbild darf maximal 2 MB groß sein.");
  const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0));
  if(bytes.byteLength>2*1024*1024) return bad("Das Profilbild darf maximal 2 MB groß sein.");
  const ext=mime==="image/jpeg"?"jpg":mime.split("/")[1]; const path=`${String(a.user.id).replace(/[^a-zA-Z0-9_-]/g,"_")}.${ext}`;
  const {url,key}=config(env); const upload=await fetch(`${url}/storage/v1/object/fib-profile-images/${encodeURIComponent(path)}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":mime,"x-upsert":"true"},body:bytes});
  if(!upload.ok){const msg=await upload.text();throw Object.assign(new Error(`Profilbild konnte nicht gespeichert werden: ${msg.slice(0,240)}`),{status:upload.status});}
  const publicUrl=`${url}/storage/v1/object/public/fib-profile-images/${encodeURIComponent(path)}?v=${Date.now()}`;
  await db(env,"users",{method:"PATCH",query:{id:`eq.${a.user.id}`},body:{profile_image:publicUrl,updated_at:new Date().toISOString()},prefer:"return=minimal"});
  await writeAudit(env,a,"profile_image_update","profile",a.user.id,"Profilbild geändert");
  return json({success:true,profileImage:publicUrl});
 }
 if(path==="profile-image/remove") {
  const a=await authz(env,args[0]||token); const old=String(a.user.profile_image||"");
  if(old){const match=old.match(/\/fib-profile-images\/([^?]+)/);if(match){const {url,key}=config(env);await fetch(`${url}/storage/v1/object/fib-profile-images/${match[1]}`,{method:"DELETE",headers:{apikey:key,Authorization:`Bearer ${key}`}}).catch(()=>{});}}
  await db(env,"users",{method:"PATCH",query:{id:`eq.${a.user.id}`},body:{profile_image:null,updated_at:new Date().toISOString()},prefer:"return=minimal"});
  await writeAudit(env,a,"profile_image_remove","profile",a.user.id,"Profilbild entfernt");
  return json({success:true,profileImage:""});
 }
 return null;
}
const MODULES = {
 announcements:{table:"fib_announcements",view:"announcements.view",manage:"announcements.manage",label:"Bekanntmachungen"},
 vacations:{table:"fib_vacations",view:"vacations.view",manage:"vacations.manage",label:"Urlaubsverwaltung"},
 ifines:{table:"fib_internal_fines",view:"ifines.view",manage:"ifines.manage",label:"Interne Bußgelder"},
 calendar:{table:"fib_calendar_events",view:"calendar.view",manage:"calendar.manage",label:"Kalender"},
 gangs:{table:"fib_gang_profiles",view:"gangs.evidence.view",manage:"gangs.evidence.manage",label:"Gang Enforcement Evidence"},
 bonuses:{table:"fib_bonus_entries",view:"bonuses.view",manage:"bonuses.manage",label:"Bonussystem"},
 dispatchbriefing:{table:"fib_dispatch_briefings",view:"patrols.view",manage:"dispatch.briefing.manage",label:"Leitstelleninformationen"},
 logs:{table:"fib_mdt_logs",view:"logs.view",manage:null,label:"Systemprotokolle"}
};
const USED_LSPD_PERMISSION_KEYS=new Set([
 "dashboard.view","patrols.view","patrols.create","patrols.edit","patrols.delete","dispatch.briefing.manage",
 "officers.view","officers.edit","officers.deactivate","organization.edit","regulations.view","regulations.manage",
 "announcements.view","announcements.manage","vacations.view","vacations.manage","ifines.view","ifines.manage",
 "vehicles.view","vehicles.manage","uniforms.view","uniforms.manage","armory.view","armory.manage","armory.special.manage",
 "academy.view","academy.manage","wanted.view","wanted.manage","warrants.view","warrants.manage",
 "records.view","records.create","records.edit","records.delete","fines.view","fines.manage",
 "lawyers.view","lawyers.manage","calendar.view","calendar.manage","gangs.evidence.view","gangs.evidence.manage",
 "bonuses.view","bonuses.manage","accounting.view","accounting.manage","logs.view",
 "system.users.view","system.users.manage","system.ranks.view","system.ranks.manage","system.permissions.view","system.permissions.manage"
]);
function normalizeModuleRow(row){const isLog=Boolean(row.action&&row.module_name);return {...row,title:row.title||row.action||"",description:row.description||row.detail||"",status:isLog?row.action:(row.status||"active"),eventDate:row.event_date||row.created_at||null,metadata:row.metadata||{}};}
function normalizePersonnelRow(row={}){
 return {...row,
  userId:row.user_id??row.userId??"",
  serviceNumber:row.service_number??row.serviceNumber??"",
  callSign:row.call_sign??row.callSign??"",
  entryDate:row.entry_date??row.entryDate??"",
  personnelStatus:row.personnel_status??row.personnelStatus??"",
  personnelNote:row.personnel_note??row.note??row.personnelNote??"",
  profileImage:row.profile_image??row.profileImage??""
 };
}
function normalizeTrainingRow(row={}){
 return {...row, userId:row.user_id??row.userId??"", expiryDate:row.expiry_date??row.expiryDate??"", createdBy:row.created_by??row.createdBy??"", createdByName:row.created_by_name??row.createdByName??""};
}
function normalizePersonnelNoteRow(row={}){
 return {...row, userId:row.user_id??row.userId??"", createdBy:row.created_by??row.createdBy??"", createdByName:row.created_by_name??row.createdByName??""};
}
async function writeAudit(env,auth,action,moduleName,itemId,detail=""){
 try {await db(env,"fib_mdt_logs",{method:"POST",body:{id:id("LOG"),action,module_name:moduleName,item_id:itemId||null,detail:String(detail||"").slice(0,500),actor_id:auth?.user?.id||null,actor_name:auth?.user?.name||"System",created_at:new Date().toISOString()},prefer:"return=minimal"});} catch(e){console.warn("Audit log skipped:",e?.message);}
}
async function writePersonnelHistory(env,auth,userId,action,detail="") {
 try {
  await db(env,"personnel_history",{method:"POST",body:{id:id("PH"),user_id:String(userId),action:String(action),detail:String(detail||"").slice(0,1000),actor_id:auth?.user?.id||null,actor_name:auth?.user?.name||"System",created_at:new Date().toISOString()},prefer:"return=minimal"});
 } catch(e) { console.warn("Personnel history skipped:",e?.message); }
}

function parsePatrolCallsign(value){
 const full=text(value);
 if(!full)return {full:"",base:"",number:"",numeric:Number.POSITIVE_INFINITY};
 const match=full.match(/^(.*?)(?:[-\s]+(\d+[A-Z]?))$/i);
 const base=match?text(match[1]):full;
 const number=match?String(match[2]).toUpperCase():"";
 const numeric=number?Number.parseInt(number,10):Number.POSITIVE_INFINITY;
 return {full,base,number,numeric:Number.isFinite(numeric)?numeric:Number.POSITIVE_INFINITY};
}
function comparePatrolCallsigns(a,b){
 const pa=parsePatrolCallsign(a), pb=parsePatrolCallsign(b);
 if(pa.numeric!==pb.numeric) return pa.numeric-pb.numeric;
 return pa.full.localeCompare(pb.full,"de",{sensitivity:"base",numeric:true});
}
function patrolServiceNumber(person){
 const explicit=text(person?.service_number??person?.serviceNumber);
 return /^\d+$/.test(explicit)?explicit:parsePatrolCallsign(person?.call_sign??person?.callSign).number;
}
function pickPrimaryPatrolCallsign(people){
 const list=(people||[]).filter(Boolean).map(p=>({call:text(p.call_sign??p.callSign),number:patrolServiceNumber(p)}));
 if(list.length===1)return list[0].call;
 const numbers=list.filter(p=>p.number).sort((a,b)=>parseInt(a.number,10)-parseInt(b.number,10)||a.number.localeCompare(b.number,"de",{numeric:true}));
 return numbers.length?`Adam-${numbers[0].number}`:"";
}
function hasEffectivePatrolEdit(au){return au.master||au.permissions.includes("*")||(au.permissions.includes("patrols.edit")&&(!au.departmentScopedPermissions.includes("patrols.edit")||au.departmentPermissions.includes("patrols.edit")));}
async function syncPatrolState(env,patrolId,actorId){
 const pid=text(patrolId);
 if(!pid) return {exists:false,members:[]};
 const members=await db(env,"patrol_members",{query:{select:"patrol_id,user_id,position",patrol_id:`eq.${pid}`}});
 if(!members?.length){
  await db(env,"patrols",{method:"DELETE",query:{id:`eq.${pid}`},prefer:"return=minimal"});
  return {exists:false,members:[]};
 }
 const userIds=[...new Set(members.map(m=>text(m.user_id)).filter(Boolean))];
 const [users,people,ranks,patrolRows]=await Promise.all([
  userIds.length?db(env,"users",{query:{select:"id,name,username,rank",id:`in.(${userIds.join(",")})`}}):[],
  userIds.length?db(env,"personnel",{query:{select:"user_id,call_sign,service_number",user_id:`in.(${userIds.join(",")})`}}):[],
  rankRows(env),
  db(env,"patrols",{query:{select:"id,callsign,number,vehicle_type,status,ten_code,location,activity,created_at,created_by,updated_at,updated_by",id:`eq.${pid}`,limit:"1"}})
 ]);
 const patrol=patrolRows?.[0];
 if(!patrol) return {exists:false,members:[]};
 const usersById=new Map((users||[]).map(u=>[String(u.id),u]));
 const peopleById=new Map((people||[]).map(p=>[String(p.user_id),p]));
 const ranksById=new Map((ranks||[]).map(r=>[String(r.id),r]));
 const ranksByName=new Map((ranks||[]).map(r=>[String(r.name),r]));
 const enriched=(members||[]).map(m=>{
   const uid=String(m.user_id);
   const u=usersById.get(uid)||{};
   const r=ranksById.get(String(u.rank))||ranksByName.get(String(u.rank))||{};
   return {
    userId:uid,
    position:text(m.position)||"Member",
    name:text(u.name),
    rankId:r.id||u.rank||"",
    rankName:r.name||u.rank||"",
    rankLevel:Number(r.level||0),
    callSign:text(peopleById.get(uid)?.call_sign),serviceNumber:patrolServiceNumber(peopleById.get(uid))
   };
  });
 enriched.sort((a,b)=>{
   if(b.rankLevel!==a.rankLevel) return b.rankLevel-a.rankLevel;
   const byNumber=(parseInt(a.serviceNumber,10)||Infinity)-(parseInt(b.serviceNumber,10)||Infinity);
   if(byNumber) return byNumber;
   const byCallsign=comparePatrolCallsigns(a.callSign,b.callSign);
   if(byCallsign!==0) return byCallsign;
   return String(a.name).localeCompare(String(b.name),"de",{sensitivity:"base"});
 });
 const desiredLead=enriched.find(m=>m.position.toLowerCase()==="lead")||enriched[0];
 if(desiredLead){
  const updates=(members||[]).map(m=>{
   const uid=String(m.user_id);
   const desired=uid===String(desiredLead.userId)?"Lead":"Member";
   if(String(m.position||"Member")===desired) return null;
   return db(env,"patrol_members",{method:"PATCH",query:{patrol_id:`eq.${pid}`,user_id:`eq.${uid}`},body:{position:desired},prefer:"return=minimal"});
  }).filter(Boolean);
  if(updates.length) await Promise.all(updates);
 }
 const primaryCallsign=pickPrimaryPatrolCallsign(enriched) || text(patrol.callsign) || text(patrol.number);
 await db(env,"patrols",{method:"PATCH",query:{id:`eq.${pid}`},body:{callsign:primaryCallsign||null,number:parsePatrolCallsign(primaryCallsign).number||primaryCallsign,updated_at:new Date().toISOString(),updated_by:actorId||null},prefer:"return=minimal"});
 return {exists:true,patrolId:pid,leadUserId:desiredLead?.userId||null,callsign:primaryCallsign,members:enriched.map(m=>({user_id:m.userId,position:m.userId===String(desiredLead?.userId||"")?"Lead":"Member"}))};
}



const EQUIPMENT_COLUMNS="id,name,category,weapon_class,special_key,description,image_url,rank_rules,active,updated_at";
const EQUIPMENT_CATEGORIES=new Set(["items","weapons","vests"]);
const WEAPON_CLASSES=new Set(["pistols","smgs","shotguns","rifles","snipers","machineguns"]);
const SPECIAL_EQUIPMENT=Object.freeze({unique_lmg:{label:"Einzigartiges LMG",weaponClass:"machineguns"},heavy_sniper:{label:"Schweres Scharfschützengewehr",weaponClass:"snipers"},heavy_sniper_mk2:{label:"Schweres Scharfschützengewehr MKII",weaponClass:"snipers"}});
function specialEquipmentKey(name){
 const n=text(name).toLowerCase().replace(/[^a-z0-9äöüß]/g,"");
 return ({einzigartigeslmg:"unique_lmg",einzigartigelmg:"unique_lmg",uniquelmg:"unique_lmg",schweresscharfschützengewehr:"heavy_sniper",heavysniper:"heavy_sniper",schweresscharfschützengewehrmkii:"heavy_sniper_mk2",schweresscharfschützengewehrmk2:"heavy_sniper_mk2",heavysnipermkii:"heavy_sniper_mk2",heavysnipermk2:"heavy_sniper_mk2"})[n]||null;
}
async function equipmentDispatch(method,args,env,token){
 if(!["getEquipmentCatalog","saveEquipmentItem","deleteEquipmentItem","getEquipmentSpecialAccess","setEquipmentSpecialAccess"].includes(method))return undefined;
 const au=await authz(env,token,"armory.view");
 const canManage=effectivePermission(au,"armory.manage"),canManageSpecial=effectivePermission(au,"armory.special.manage");
 if(method==="getEquipmentSpecialAccess"||method==="setEquipmentSpecialAccess"){
  if(!canManageSpecial)throw recordError("Keine Berechtigung zur Verwaltung von Spezialfreigaben.",403);
  if(method==="getEquipmentSpecialAccess"){
   const [users,grants]=await Promise.all([db(env,"users",{query:{select:"id,name,rank",active:"eq.true",approved:"eq.true",order:"name.asc"}}),db(env,"lspd_equipment_special_access",{query:{select:"user_id,special_key,enabled,note,updated_by_name,updated_at"}})]);
   const ids=new Set((users||[]).map(u=>String(u.id)));
   return {users,grants:(grants||[]).filter(g=>ids.has(String(g.user_id))),specials:SPECIAL_EQUIPMENT};
  }
  const d=args[1]||{},uid=text(d.userId),special=text(d.specialKey),note=text(d.note);
  if(!uid||!Object.hasOwn(SPECIAL_EQUIPMENT,special)||typeof d.enabled!=="boolean"||note.length>1000)throw recordError("Ungültige Spezialfreigabe.");
  if(d.enabled&&!au.master&&uid===String(au.user.id))throw recordError("Du darfst dir selbst keine Spezialfreigabe erteilen.",403);
  const target=await db(env,"users",{query:{select:"id,name",id:`eq.${uid}`,active:"eq.true",approved:"eq.true",limit:"1"}});
  if(!target?.length)throw recordError("Aktiver Mitarbeiter nicht gefunden.",404);
  const row={user_id:uid,special_key:special,enabled:d.enabled,note,updated_by:au.user.id,updated_by_name:au.user.name,updated_at:new Date().toISOString()};
  await db(env,"lspd_equipment_special_access",{method:"POST",query:{on_conflict:"user_id,special_key"},body:row,prefer:"resolution=merge-duplicates,return=minimal"});
  await writeAudit(env,au,d.enabled?"special_grant":"special_revoke","armory",uid,`${SPECIAL_EQUIPMENT[special].label} · ${target[0].name} · ${note}`);
  return {success:true,grant:row};
 }
 if(method==="getEquipmentCatalog"){
  const [ranks,items,grants]=await Promise.all([rankRows(env),db(env,"fib_equipment_catalog",{query:{select:EQUIPMENT_COLUMNS,order:"category.asc,name.asc,id.asc",...(canManage?{}:{active:"eq.true"}),limit:"1000"}}),db(env,"lspd_equipment_special_access",{query:{select:"special_key,enabled,updated_at",user_id:`eq.${au.user.id}`,enabled:"eq.true"}})]);
  const activeRanks=(ranks||[]).filter(r=>r.active!==false);
  const ownRank=activeRanks.find(r=>String(r.id)===String(au.user.rank))||activeRanks.find(r=>r.name===au.user.rank);
  const ownId=String(ownRank?.id||""),ownGrants=new Map((grants||[]).filter(g=>g.enabled===true).map(g=>[g.special_key,g]));
  const blocked=[];
  const personal=(items||[]).filter(x=>x.active!==false).flatMap(x=>{
   const rule=(Array.isArray(x.rank_rules)?x.rank_rules:[]).find(r=>String(r.rankId)===ownId&&r.enabled!==false&&Number(r.quantity)>0);
   if(!ownId||!rule)return [];
   const special=x.special_key||specialEquipmentKey(x.name);
   if(special&&!ownGrants.has(special)){blocked.push({id:x.id,name:x.name,special_key:special});return [];}
   const {rank_rules,...item}=x;
   return [{...item,special_key:special,grantVersion:special?ownGrants.get(special)?.updated_at:undefined,quantity:rule.quantity,ammunition:x.category==="weapons"?rule.ammunition:undefined}];
  });
  return {profile:{id:au.user.id,name:au.user.name,rank:ownRank?.name||"Kein aktiver Rang",rankId:ownId},canManage,canManageSpecial,personal,blocked,specials:SPECIAL_EQUIPMENT,ownSpecial:[...ownGrants.keys()],items:canManage?items:[],ranks:canManage?activeRanks.map(r=>({id:r.id,name:r.name,level:r.level})):[]};
 }
 if(!canManage)throw recordError("Keine Berechtigung zur Ausrüstungsverwaltung.",403);
 if(method==="deleteEquipmentItem"){
  const itemId=text(args[1]);if(!itemId)throw recordError("Eintrag fehlt.");
  const result=await db(env,"fib_equipment_catalog",{method:"DELETE",query:{id:`eq.${itemId}`,select:"id"},prefer:"return=representation"});
  if(!result?.length)throw recordError("Eintrag nicht gefunden.",404);return {success:true};
 }
 const d=args[1]||{},name=text(d.name),category=text(d.category),description=text(d.description),imageUrl=text(d.imageUrl),itemId=text(d.id);
 if(!name||name.length>180||!EQUIPMENT_CATEGORIES.has(category)||description.length>2000)throw recordError("Bitte Bezeichnung, Kategorie und Beschreibung prüfen.");
 if(imageUrl&&(!/^https:\/\//i.test(imageUrl)||imageUrl.length>2000))throw recordError("Bitte einen gültigen HTTPS-Bildlink verwenden.");
 let weaponClass=text(d.weaponClass)||null,special=text(d.specialKey)||null;
 if(weaponClass&&!WEAPON_CLASSES.has(weaponClass))throw recordError("Ungültige Waffenunterkategorie.");
 if(special&&!Object.hasOwn(SPECIAL_EQUIPMENT,special))throw recordError("Ungültige Spezialwaffe.");
 const detected=specialEquipmentKey(name);
 if(detected&&special&&detected!==special)throw recordError("Spezialfreigabe passt nicht zur Bezeichnung.");
 if(itemId){const old=(await db(env,"fib_equipment_catalog",{query:{select:"id,name,special_key",id:`eq.${itemId}`,limit:"1"}}))?.[0];if(!old)throw recordError("Eintrag nicht gefunden.",404);const previous=old.special_key||specialEquipmentKey(old.name);if(previous&&(detected&&detected!==previous||special&&special!==previous))throw recordError("Die hinterlegte Spezialfreigabe kann nicht umgangen werden.");special=previous||special;}
 special=detected||special;
 if(special&&category!=="weapons")throw recordError("Spezialwaffen müssen in der Kategorie Waffen bleiben.");
 if(special)weaponClass=SPECIAL_EQUIPMENT[special].weaponClass;
 if(category!=="weapons")weaponClass=null;
 if(!Array.isArray(d.rankRules))throw recordError("Rangfreigaben fehlen.");
 const ranks=await rankRows(env),validRanks=new Set((ranks||[]).filter(r=>r.active!==false).map(r=>String(r.id))),seen=new Set();
 const number=(v,min)=>{if(typeof v!=="number"||!Number.isSafeInteger(v)||v<min||v>1000000)throw recordError("Mengen müssen gültige ganze Zahlen sein.");return v;};
 const rules=d.rankRules.map(r=>{
  const rankId=text(r?.rankId);if(!validRanks.has(rankId)||seen.has(rankId))throw recordError("Ungültiger oder doppelter Rang.");seen.add(rankId);
  const rule={rankId,quantity:number(r.quantity,1)};
  if(category==="weapons")rule.ammunition=number(r.ammunition,0);
  return rule;
 });
 const row={name,category,weapon_class:weaponClass,special_key:special,description,image_url:imageUrl||null,rank_rules:rules,active:d.active!==false,updated_at:new Date().toISOString(),updated_by:au.user.id};
 const saved=await db(env,"fib_equipment_catalog",itemId?{method:"PATCH",query:{id:`eq.${itemId}`,select:EQUIPMENT_COLUMNS},body:row,prefer:"return=representation"}:{method:"POST",query:{select:EQUIPMENT_COLUMNS},body:{...row,id:id("EQ"),created_by:au.user.id},prefer:"return=representation"});
 if(!saved?.length)throw recordError("Eintrag konnte nicht gespeichert werden.",404);
 return {success:true,item:saved[0]};
}

async function uniformDispatch(method,args,env,token){
  const supported=["getUniformCatalog","saveUniformCatalogItem","deleteUniformCatalogItem"];
  if(!supported.includes(method)) return undefined;
  if(method==="getUniformCatalog"){
    const au=await authz(env,token,"officers.view");
    const [personnelRows,ranks,rules,items]=await Promise.all([
      db(env,"personnel",{query:{select:"user_id,department,unit,call_sign,service_number",user_id:`eq.${au.user.id}`,limit:"1"}}),
      rankRows(env),
      db(env,"fib_uniform_organization_rules",{query:{select:"id,organization_unit,regular_class,supplementary_classes,source_note",order:"organization_unit.asc",limit:"100"}}),
      db(env,"fib_uniform_catalog",{query:{select:"id,name,uniform_class,description,image_url,organization_units,active,created_at,updated_at",active:"eq.true",order:"uniform_class.asc,name.asc",limit:"500"}})
    ]);
    const person=personnelRows?.[0]||{};
    const rank=ranks?.find(r=>String(r.id)===String(au.user.rank))||ranks?.find(r=>String(r.name)===String(au.user.rank));
    const department=text(person.department),unit=text(person.unit);
    const normalize=v=>String(v||"").trim().toLowerCase().replace(/\s+/g," ");
    const candidates=[`${department} – ${unit}`,`${department} - ${unit}`,`${unit} – ${department}`,department,unit].filter(Boolean).map(normalize);
    // Canonical organization values used by the MDT. These are the only organization/division
    // labels exposed by the personnel system. Sub-unit names may still be stored in `unit`
    // and are resolved to the exact canonical organization label when a matching rule exists.
    const canonicalOrganizations=[
      "Internal Affairs Division",
      "Central Division",
      "Northern Division",
      "Patrol Division",
      "Investigative Division",
      "Metropolitan Division",
      "Support Division",
      "Internal Affairs",
      "Patrol Unit",
      "Detective Bureau",
      "Special Weapons and Tactics",
      "Gang Enforcement Detail",
      "Canine (K9)",
      "Police Academy",
      "Public Relations Office",
      "Air Support Division",
      "High Command"
    ];
    const aliases={
      "detective bureau":"investigative division – detective bureau",
      "special weapons and tactics":"metropolitan division – s.w.a.t.",
      "gang enforcement detail":"metropolitan division – gang enforcement detail",
      "canine (k9)":"metropolitan division – k9 unit",
      "police academy":"support division – police academy",
      "air support division":"support division – air support unit",
      "air support unit":"support division – air support unit",
      "public relations office":"support division – public relations office",
      "internal affairs":"internal affairs division",
      "high command":"high command"
    };
    const canonicalCandidates=candidates.concat(canonicalOrganizations.filter(v=>candidates.includes(normalize(v))));
    const candidateAliases=candidates.map(c=>aliases[c]).filter(Boolean);
    const rule=(rules||[]).find(r=>canonicalCandidates.includes(normalize(r.organization_unit))||candidateAliases.includes(normalize(r.organization_unit)))||null;
    const allowedClasses=new Set([...String(rule?.regular_class||"").split("/").map(text).filter(Boolean),...(Array.isArray(rule?.supplementary_classes)?rule.supplementary_classes:[])]);
    const scope=new Set([...candidates,...candidateAliases,normalize(rule?.organization_unit)].filter(Boolean));
    const visibleItems=au.master?(items||[]):(items||[]).filter(x=>allowedClasses.has(x.uniform_class)&&(!Array.isArray(x.organization_units)||!x.organization_units.length||x.organization_units.some(v=>scope.has(normalize(v)))));
    return {
      profile:{id:au.user.id,name:au.user.name,rank:rank?.name||au.user.rank||"Kein Rang",rankId:rank?.id||au.user.rank||"",department,unit,callSign:text(person.call_sign),serviceNumber:text(person.service_number)},
      organization:rule?{...rule,label:rule.organization_unit}:null,
      items:visibleItems,
      rules:au.master?(rules||[]):(rule?[rule]:[]),
      canManage:au.master===true
    };
  }
  if(method==="saveUniformCatalogItem"){
    const au=await authz(env,token);
    if(au.master!==true)throw Object.assign(new Error("Nur ein Master darf Dienstkleidung anlegen oder bearbeiten."),{status:403});
    const d=args[0]||{},name=text(d.name),uniformClass=text(d.uniformClass||d.uniform_class),imageUrl=text(d.imageUrl||d.image_url),description=text(d.description);
    if(!name)throw new Error("Bitte eine Bezeichnung angeben.");
    if(!["A","B","C","D","E","F"].includes(uniformClass))throw new Error("Bitte eine gültige Uniformklasse auswählen.");
    if(imageUrl&&!/^https:\/\//i.test(imageUrl))throw new Error("Der Bildlink muss eine HTTPS-Adresse sein.");
    const row={name,uniform_class:uniformClass,description:description||null,image_url:imageUrl||null,active:d.active!==false,updated_at:new Date().toISOString(),created_by:au.user.id,created_by_name:au.user.name};
    const itemId=text(d.id);
    const organizationUnits=Array.isArray(d.organizationUnits)?[...new Set(d.organizationUnits.map(text).filter(Boolean))]:[];
    row.organization_units=organizationUnits;
    const saved=itemId
      ? (await db(env,"fib_uniform_catalog",{method:"PATCH",query:{id:`eq.${itemId}`,select:"id,name,uniform_class,description,image_url,organization_units,active,created_at,updated_at"},body:row,prefer:"return=representation"}))?.[0]
      : (await db(env,"fib_uniform_catalog",{method:"POST",query:{select:"id,name,uniform_class,description,image_url,organization_units,active,created_at,updated_at"},body:{...row,id:id("UNI"),created_at:new Date().toISOString()},prefer:"return=representation"}))?.[0];
    return {success:true,item:saved||row};
  }
  if(method==="deleteUniformCatalogItem"){
    const au=await authz(env,token);
    if(au.master!==true)throw Object.assign(new Error("Nur ein Master darf Dienstkleidung entfernen."),{status:403});
    const itemId=text(args[0]);if(!itemId)throw new Error("Katalogeintrag fehlt.");
    await db(env,"fib_uniform_catalog",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});
    return {success:true};
  }
  return undefined;
}

async function financeDispatch(method,args,env,token){
  const supported=["getFinanceAccess","getBonusData","saveBonusSubmission","saveBonusForEmployee","approveBonusSubmission","rejectBonusSubmission","payBonusSubmission","getAccountingData","createAccountingEntry","setOrgAccountBalance"];
  if(!supported.includes(method)) return undefined;
  const now=new Date().toISOString();
  const rates={event:15000,towing:5000,drugs:5000,entry_control:25000};
  const permits=(au,key)=>au.master||((au.permissions.includes("*")||au.permissions.includes(key))&&(!au.departmentScopedPermissions.includes(key)||au.departmentPermissions.includes(key)));
  const calcTotal=d=>{
    const counts=[d.eventCount,d.towingCount,d.drugsCount,d.entryControlCount].map(x=>Number(x??0));
    if(counts.some(x=>!Number.isSafeInteger(x)||x<0))throw Object.assign(new Error("Aktivitäten müssen als nichtnegative ganze Zahlen angegeben werden."),{status:400});
    const total=counts.reduce((sum,n,i)=>sum+n*Object.values(rates)[i],0);
    if(!Number.isSafeInteger(total)||total>9999999999)throw Object.assign(new Error("Bonusbetrag ist zu hoch."),{status:400});
    return total;
  };
  const assertDate=v=>{if(!text(v)||!Number.isFinite(Date.parse(v)))throw Object.assign(new Error("Bitte ein gültiges Tätigkeitsdatum angeben."),{status:400});return new Date(v).toISOString();};
  const eligibleRank=(u,ranks)=>ranks.find(r=>String(r.id)===String(u.rank)||String(r.name)===String(u.rank));
  const checkEligible=async(uid)=>{
    const [users,ranks]=await Promise.all([db(env,"users",{query:{select:"id,name,rank,active,approved",id:`eq.${uid}`,limit:"1"}}),rankRows(env)]);
    const u=users?.[0],r=u&&eligibleRank(u,ranks);
    if(!u||!u.active||!u.approved||Number(r?.level||0)<=1)throw Object.assign(new Error("Bonusauszahlungen sind nur für aktive, freigegebene Mitarbeiter über Rang-Level 1 vorgesehen."),{status:400});
    return {u,r};
  };
  const patchOpen=async(rid,patch,allowed,owner,expectedUpdatedAt)=>{
    const q={id:`eq.${rid}`,status:`in.(${allowed.join(",")})`,select:"*"};if(owner)q.employee_id=`eq.${owner}`;if(expectedUpdatedAt)q.updated_at=`eq.${expectedUpdatedAt}`;
    const rows=await db(env,"fib_bonus_payouts",{method:"PATCH",query:q,body:patch,prefer:"return=representation"});
    if(!rows?.length)throw Object.assign(new Error("Diese Einreichung wurde inzwischen bearbeitet. Bitte aktualisieren."),{status:409});return rows[0];
  };
  if(method==="getFinanceAccess"){
    const au=await authz(env,token);return {bonuses:permits(au,"bonuses.view"),accounting:permits(au,"accounting.view")};
  }
  if(method==="getBonusData"){
    const au=await authz(env,token,"bonuses.view");
    const canManage=permits(au,"bonuses.manage");
    const q={select:"id,employee_id,employee_name,rank_id,rank_name,rank_level,event_count,towing_count,drugs_count,entry_control_count,total_amount,status,evidence,description,activity_date,submitted_at,reviewed_at,reviewed_by_name,rejection_reason,paid_at,paid_by_name,updated_at",order:"submitted_at.desc,id.desc",limit:"501"};
    if(!canManage)q.employee_id=`eq.${au.user.id}`;
    const [ranks,rows,users,people]=await Promise.all([rankRows(env),db(env,"fib_bonus_payouts",{query:q}),canManage?db(env,"users",{query:{select:"id,name,rank,active,approved",active:"eq.true",approved:"eq.true",order:"name.asc"}}):[],canManage?db(env,"personnel",{query:{select:"user_id,department,unit,call_sign"}}):[]]);
    const peopleBy=new Map(people.map(p=>[String(p.user_id),p]));
    const rankBy=new Map(ranks.flatMap(r=>[[String(r.id),r],[String(r.name),r]]));
    const eligible=users.map(u=>{const r=rankBy.get(String(u.rank)),p=peopleBy.get(String(u.id))||{};return {...u,rankId:r?.id||u.rank,rankName:r?.name||u.rank||"Kein Rang",rankLevel:Number(r?.level||0),department:p.department||"",unit:p.unit||"",callSign:p.call_sign||""};}).filter(u=>u.rankLevel>1);
    const currentRank=rankBy.get(String(au.user.rank));
    return {rates,eligibleEmployees:eligible,submissions:rows.slice(0,500),truncated:rows.length>500,canManage,currentUser:{id:au.user.id,name:au.user.name,rankLevel:Number(currentRank?.level||0)}};
  }
  if(method==="saveBonusSubmission"||method==="saveBonusForEmployee"){
    const manual=method==="saveBonusForEmployee";
    const au=await authz(env,token,manual?"bonuses.manage":"bonuses.view");
    const d=args[1]||{},uid=manual?text(d.employeeId):String(au.user.id),existingId=text(d.id);
    if(!uid)throw Object.assign(new Error("Mitarbeiter fehlt."),{status:400});
    const total=calcTotal(d);if(total<=0)throw Object.assign(new Error("Bitte mindestens eine bonusfähige Aktivität angeben."),{status:400});
    if(!text(d.description))throw Object.assign(new Error("Bitte eine Beschreibung angeben."),{status:400});
    const evidence=text(d.evidence);
    if((!manual||evidence)&&!/^https:\/\/[^\s]+$/i.test(evidence))throw Object.assign(new Error("Bitte einen HTTPS-Nachweislink mit dem Beweisbild angeben."),{status:400});
    const activityDate=assertDate(d.activityDate);
    const {u,r}=await checkEligible(uid);
    const payload={employee_id:u.id,employee_name:u.name,rank_id:r.id,rank_name:r.name,rank_level:Number(r.level),event_count:Number(d.eventCount||0),towing_count:Number(d.towingCount||0),drugs_count:Number(d.drugsCount||0),entry_control_count:Number(d.entryControlCount||0),total_amount:total,status:"pending",evidence,description:text(d.description),activity_date:activityDate,updated_at:now};
    if(existingId){
      if(manual)throw Object.assign(new Error("Der Bonusrechner erstellt eine eigenständige Vormerkung. Bestehende Einreichungen bleiben unverändert."),{status:400});
      return patchOpen(existingId,{...payload,reviewed_at:null,reviewed_by:null,reviewed_by_name:null,rejection_reason:null},["pending","rejected"],uid,text(d.expectedUpdatedAt));
    }
    const row={id:id("BON"),...payload,submitted_at:now,created_at:now,created_by:au.user.id,created_by_name:au.user.name};
    const saved=await db(env,"fib_bonus_payouts",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return saved?.[0]||row;
  }
  if(method==="approveBonusSubmission"||method==="rejectBonusSubmission"){
    const au=await authz(env,token,"bonuses.manage"),rid=text(args[1]),reject=method==="rejectBonusSubmission",reason=reject?text(args[2]):"";
    let expected=text(reject?args[3]:args[2]);
    if(reject&&!reason)throw Object.assign(new Error("Bitte einen Ablehnungsgrund angeben."),{status:400});
    if(!reject){
      const row=(await db(env,"fib_bonus_payouts",{query:{select:"id,employee_id,status,total_amount,updated_at",id:`eq.${rid}`,limit:"1"}}))?.[0];
      if(!row||row.status!=="pending"||!(Number(row.total_amount)>0))throw Object.assign(new Error("Nur offene Einreichungen mit positivem Betrag können genehmigt werden."),{status:400});
      if(expected&&expected!==String(row.updated_at||""))throw Object.assign(new Error("Diese Einreichung wurde inzwischen geändert. Bitte erneut prüfen."),{status:409});
      expected=expected||text(row.updated_at);
      await checkEligible(row.employee_id);
    }
    return patchOpen(rid,{status:reject?"rejected":"approved",reviewed_at:now,reviewed_by:au.user.id,reviewed_by_name:au.user.name,rejection_reason:reject?reason:"",updated_at:now},["pending"],null,expected);
  }
  if(method==="payBonusSubmission"){
    const au=await authz(env,token,"bonuses.manage");const rid=text(args[1]);const rows=await db(env,"fib_bonus_payouts",{query:{select:"*",id:`eq.${rid}`,limit:"1"}});const row=rows?.[0];if(!row)throw Object.assign(new Error("Bonus-Einreichung nicht gefunden."),{status:404});if(String(row.status)!=="approved"||!(Number(row.total_amount)>0))throw Object.assign(new Error("Nur genehmigte Bonusauszahlungen mit positivem Betrag können ausgezahlt werden."),{status:400});await checkEligible(row.employee_id);
    const atomic=await rpc(env,"lspd_pay_bonus_payout",{p_bonus_id:rid,p_user_id:au.user.id,p_user_name:au.user.name}); const saved=(await db(env,"fib_bonus_payouts",{query:{select:"*",id:`eq.${rid}`,limit:"1"}}))?.[0]; return {success:true,item:saved||row,balance:Number(atomic?.balance||0)};
  }
  if(method==="getAccountingData"){
    const au=await authz(env,token,"accounting.view");const [acct,entries]=await Promise.all([db(env,"fib_org_account",{query:{select:"id,balance,updated_at",id:"eq.MAIN",limit:"1"}}),db(env,"fib_accounting_entries",{query:{select:"id,entry_type,amount,purpose,description,reference_type,reference_id,created_by,created_by_name,created_at",order:"created_at.desc",limit:"500"}})]);return {balance:Number(acct?.[0]?.balance||0),updatedAt:acct?.[0]?.updated_at||null,entries:entries||[],canManage:permits(au,"accounting.manage")};
  }
  if(method==="createAccountingEntry"||method==="setOrgAccountBalance"){
    const au=await authz(env,token,"accounting.manage"),adjustment=method==="setOrgAccountBalance",d=args[1]||{};
    const type=adjustment?"adjustment":text(d.entryType),amount=Number(adjustment?args[1]:d.amount);
    if((!adjustment&&! ["income","expense"].includes(type))||!Number.isFinite(amount)||amount<0||(!adjustment&&amount===0)||amount>999999999999.99||Math.abs(amount*100-Math.round(amount*100))>0.0001)throw Object.assign(new Error("Bitte einen gültigen Dollarbetrag mit maximal zwei Nachkommastellen eingeben."),{status:400});
    if(!adjustment&&!text(d.purpose))throw Object.assign(new Error("Ein Verwendungszweck ist erforderlich."),{status:400});
    return rpc(env,"lspd_book_accounting_v49",{p_type:type,p_amount:amount,p_purpose:adjustment?"Manuelle Kontostandsanpassung":text(d.purpose),p_description:adjustment?"":text(d.description),p_user_id:au.user.id,p_user_name:au.user.name});
  }
}

function canManageVacations(au){return au.master||effectivePermission(au,"vacations.manage")||(effectivePermission(au,"academy.manage")&&!!au.department&&academyDepartmentHas(null,au,"academy.manage"));}
async function vacationDispatch(method,args,env,token){
  const supported=["getVacationRequests","createVacationRequest","approveVacationRequest","rejectVacationRequest","cancelVacationRequest"];
  if(!supported.includes(method)) return undefined;
  const now=new Date().toISOString();
  if(method==="getVacationRequests"){
    const au=await authz(env,token,"vacations.view");
    const manage=canManageVacations(au);
    const q={select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at",order:"event_date.desc,created_at.desc",limit:"200"};
    if(!manage) q.created_by=`eq.${au.user.id}`;
    const rows=[];q.order="event_date.desc,created_at.desc,id.asc";q.limit="500";
    for(let offset=0;;offset+=500){const batch=await db(env,"fib_vacations",{query:{...q,offset:String(offset)}});rows.push(...(batch||[]));if(!batch||batch.length<500)break;}
    return {userId:au.user.id,canManage:manage,requests:rows.map(normalizeModuleRow)};
  }
  if(method==="createVacationRequest"){
    const au=await authz(env,token,"vacations.view");
    const d=args[1]||{},start=text(d.startDate),end=text(d.endDate),reason=text(d.reason);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||reason.length>1000) throw recordError("Bitte einen gültigen Zeitraum von–bis angeben (Hinweis maximal 1000 Zeichen).");
    const s=new Date(`${start}T00:00:00`),e=new Date(`${end}T23:59:59`);
    if(Number.isNaN(s.getTime())||Number.isNaN(e.getTime())||new Date(start+"T00:00:00Z").toISOString().slice(0,10)!==start||new Date(end+"T00:00:00Z").toISOString().slice(0,10)!==end) throw recordError("Der Urlaubszeitraum ist ungültig.");
    if(e<s) throw recordError("Das Enddatum darf nicht vor dem Startdatum liegen.");
    const existing=[];
    for(let offset=0;;offset+=500){const batch=await db(env,"fib_vacations",{query:{select:"id,status,metadata",created_by:`eq.${au.user.id}`,status:"in.(pending,approved)",order:"id.asc",limit:"500",offset:String(offset)}});existing.push(...(batch||[]));if(!batch||batch.length<500)break;}
    const overlap=(existing||[]).some(r=>!['rejected','cancelled'].includes(String(r.status||'').toLowerCase())&&(()=>{const m=r.metadata||{},a=new Date(`${m.start_date||''}T00:00:00`),b=new Date(`${m.end_date||''}T23:59:59`);return !Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime())&&s<=b&&e>=a;})());
    if(overlap) throw recordError("Für diesen Zeitraum existiert bereits ein nicht abgelehnter Urlaubsantrag.",409);
    const meta={entry_type:"vacation_request",start_date:start,end_date:end,reason,employee_id:au.user.id,employee_name:au.user.name};
    const row={id:id("VAC"),title:`Urlaubsantrag – ${au.user.name}`,description:reason,status:"pending",event_date:s.toISOString(),metadata:meta,created_by:au.user.id,created_by_name:au.user.name,created_at:now,updated_at:now};
    const saved=await db(env,"fib_vacations",{method:"POST",query:{select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at"},body:row,prefer:"return=representation"});
    return normalizeModuleRow(saved?.[0]||row);
  }
  if(method==="approveVacationRequest"||method==="rejectVacationRequest"){
    const au=await authz(env,token,"vacations.view");if(!canManageVacations(au))throw recordError("Keine Berechtigung zur Urlaubsentscheidung.",403);
    const requestId=text(args[1]); if(!requestId) throw new Error("Urlaubsantrag fehlt.");
    const rows=await db(env,"fib_vacations",{query:{select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at",id:`eq.${requestId}`,limit:"1"}});
    const row=rows?.[0]; if(!row) throw Object.assign(new Error("Urlaubsantrag nicht gefunden."),{status:404});
    if(String(row.status).toLowerCase()!=="pending") throw recordError("Dieser Urlaubsantrag wurde bereits bearbeitet.",409);
    const status=method==="approveVacationRequest"?"approved":"rejected";
    const metadata={...(row.metadata||{}),decision_by:au.user.id,decision_by_name:au.user.name,decision_at:now,rejection_reason:method==="rejectVacationRequest"?text(args[2]):""};
    const saved=await db(env,"fib_vacations",{method:"PATCH",query:{id:`eq.${requestId}`,status:"eq.pending",select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at"},body:{status,metadata,updated_at:now},prefer:"return=representation"});
    if(!saved?.length)throw recordError("Der Antrag wurde zwischenzeitlich bearbeitet.",409);return normalizeModuleRow(saved[0]);
  }
  if(method==="cancelVacationRequest"){
    const au=await authz(env,token,"vacations.view");
    const requestId=text(args[1]);
    const rows=await db(env,"fib_vacations",{query:{select:"id,status,created_by,metadata",id:`eq.${requestId}`,limit:"1"}});const row=rows?.[0];if(!row)throw new Error("Urlaubsantrag nicht gefunden.");
    if(!au.master&&String(row.created_by)!==String(au.user.id))throw Object.assign(new Error("Du kannst nur eigene Urlaubsanträge zurückziehen."),{status:403});
    if(!["pending","approved"].includes(String(row.status).toLowerCase()))throw new Error("Dieser Antrag kann nicht mehr zurückgezogen werden.");
    const metadata={...(row.metadata||{}),cancelled_by:au.user.id,cancelled_by_name:au.user.name,cancelled_at:now};
    const saved=await db(env,"fib_vacations",{method:"PATCH",query:{id:`eq.${requestId}`,status:`eq.${row.status}`,select:"id"},body:{status:"cancelled",metadata,updated_at:now},prefer:"return=representation"});if(!saved?.length)throw recordError("Der Antrag wurde zwischenzeitlich bearbeitet.",409);return {success:true};
  }
}

async function moduleDispatch(method,args,env,token){
 const actions={getModuleItems:"list",createModuleItem:"create",updateModuleItem:"update",deleteModuleItem:"delete"};
 const action=actions[method]; if(!action)return undefined;
 const moduleKey=text(action==="list"?args[1]:args[action==="create"?1:1]).toLowerCase();
 const cfg=MODULES[moduleKey]; if(!cfg)throw Object.assign(new Error("Unbekanntes MDT-Modul."),{status:400});
 if(moduleKey==="vacations")throw recordError("Bitte die Urlaubsantragsfunktionen verwenden.",403);
 const auth=await authz(env,token,moduleKey==="calendar"&&action==="list"?undefined:cfg.view);
 const briefing=moduleKey==="dispatchbriefing";
 const itemColumns="id,title,description,status,"+(briefing?"":"event_date,")+"metadata,created_by,created_by_name,created_at,updated_at";
 if(moduleKey==="gangs"&&!auth.master&&!auth.departmentPermissions.includes(cfg.view))throw recordError("Keine Abteilungsfreigabe für Gang-Beweise.",403);
 if(action==="list"){
  const query={select:moduleKey==="logs"?"id,action,module_name,item_id,detail,actor_id,actor_name,created_at":itemColumns,order:briefing?"updated_at.desc,id.desc":"created_at.desc",limit:moduleKey==="logs"?"300":briefing?"1":"200"};
  if(moduleKey==="announcements"&&!effectivePermission(auth,cfg.manage)) query.status="eq.active";
  if(moduleKey==="logs")query.module_name="not.in.(classification,classifications,fib_classification)";
  if(moduleKey==="logs"&&!auth.master&&!auth.permissions.includes("*"))await authz(env,token,"logs.view");
  const rows=moduleKey==="calendar"&&!effectivePermission(auth,cfg.view)?[]:await db(env,cfg.table,{query});
  if(moduleKey!=="calendar")return (rows||[]).map(normalizeModuleRow);
  // Public to every authenticated MDT user: name and approved date range only.
  const vacationRows=[];
  for(let offset=0;;offset+=500){
   const batch=await db(env,"fib_vacations",{query:{select:"id,status,event_date,metadata,created_by_name",status:"eq.approved",order:"event_date.asc,id.asc",limit:"500",offset:String(offset)}});
   vacationRows.push(...(batch||[]));if(!batch||batch.length<500)break;
  }
  const projected=vacationRows.map(v=>{const m=v.metadata||{};return {id:`vacation:${v.id}`,title:`Urlaub – ${m.employee_name||v.created_by_name||"Mitarbeiter"}`,description:"Genehmigter Urlaub",status:"approved",event_date:v.event_date||m.start_date||null,metadata:{entry_type:"vacation",start_date:m.start_date,end_date:m.end_date}};});
  return [...(rows||[]),...projected].map(normalizeModuleRow);
 }
 if(!cfg.manage)throw Object.assign(new Error("Dieses Modul ist schreibgeschützt."),{status:403});
 if(!effectivePermission(auth,cfg.manage)||(moduleKey==="gangs"&&!auth.master&&!auth.departmentPermissions.includes(cfg.manage)))throw Object.assign(new Error("Du besitzt keine Änderungsberechtigung für dieses Modul."),{status:403});
 if(action==="create"){
  const d=args[2]||{}; const title=text(d.title); if(!title)throw new Error("Ein Titel ist erforderlich.");
  const row={id:id(moduleKey.slice(0,3).toUpperCase()),title,description:text(d.description),status:text(d.status)||"active",event_date:d.eventDate||d.event_date||null,metadata:d.metadata&&typeof d.metadata==="object"?d.metadata:{},created_by:auth.user.id,created_by_name:auth.user.name,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  if(briefing){
   delete row.event_date;
   if(row.description.length>20000)throw recordError("Leitstelleninformationen dürfen maximal 20.000 Zeichen enthalten.",400);
   row.metadata={entry_type:"dispatch_briefing",application:"lspd",updated_by_name:auth.user.name};
  }
  const saved=await db(env,cfg.table,{method:"POST",query:{select:itemColumns},body:row,prefer:"return=representation"}); return normalizeModuleRow(saved?.[0]||row);
 }
 const itemId=text(args[2]); if(!itemId)throw new Error("Ein Eintrag muss ausgewählt werden.");if(moduleKey==="calendar"&&itemId.startsWith("vacation:"))throw recordError("Urlaub nur über den Urlaubsantrag ändern.",403);
 if(action==="delete") {await db(env,cfg.table,{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});return {success:true};}
 const d=args[3]||{}; const patch={updated_at:new Date().toISOString()};
 for(const k of ["title","description","status"])if(d[k]!==undefined)patch[k]=text(d[k]);
 if(!briefing&&(d.eventDate!==undefined||d.event_date!==undefined))patch.event_date=d.eventDate||d.event_date||null;
 if(d.metadata!==undefined)patch.metadata=d.metadata&&typeof d.metadata==="object"?d.metadata:{};
 if(briefing){
  if((patch.description||"").length>20000)throw recordError("Leitstelleninformationen dürfen maximal 20.000 Zeichen enthalten.",400);
  patch.metadata={entry_type:"dispatch_briefing",application:"lspd",updated_by_name:auth.user.name};
 }
 const saved=await db(env,cfg.table,{method:"PATCH",query:{id:`eq.${itemId}`,select:itemColumns},body:patch,prefer:"return=representation"});if(briefing&&!saved?.length)throw recordError("Leitstelleninformation nicht mehr vorhanden. Bitte aktualisieren.",409);return normalizeModuleRow(saved?.[0]||{id:itemId,...patch});
}
function academyDepartmentHas(env,au,permission){
 if(au.master)return true;
 return Array.isArray(au.departmentPermissions) && au.departmentPermissions.includes(permission);
}
async function academyAccess(env,token,permission="academy.view"){
 const au=await authz(env,token,permission);
 if(!au.master&&!au.department)throw Object.assign(new Error("Deiner Personalakte ist keine Abteilung zugeordnet. Der Academy-Zugriff kann daher nicht ermittelt werden."),{status:403});
 return au;
}
async function academyDispatch(method,args,env,token){
 if(!["academyGetData","academySaveDocument","academyDeleteDocument","academyGetDocumentFile","academySaveTest","academyDeleteTest","academyGetTestForAttempt","academySubmitTest"].includes(method))return undefined;
 if(method==="academyGetData"){
  const au=await academyAccess(env,token,"academy.view");
  const rankRowsData=await rankRows(env); const viewerRank=rankRowsData.find(r=>String(r.id)===String(au.user.rank))||rankRowsData.find(r=>String(r.name)===String(au.user.rank));
  const [documents,tests,results]=await Promise.all([
   db(env,"academy_documents",{query:{select:"id,title,category,description,content,active,file_name,file_path,mime_type,file_size,created_by,created_by_name,created_at,updated_at",active:"eq.true",order:"updated_at.desc",limit:"200"}}),
   db(env,"academy_tests",{query:{select:"id,title,category,description,active,passing_score,questions,eligible_rank_ids,created_by,created_by_name,created_at,updated_at",active:"eq.true",order:"updated_at.desc",limit:"100"}}),
   db(env,"academy_attempts",{query:{select:"id,test_id,score,passed,submitted_at",user_id:`eq.${au.user.id}`,order:"submitted_at.desc",limit:"100"}})
  ]);
  const testMap=new Map((tests||[]).map(t=>[String(t.id),t.title]));
  const manageDepartment=await academyDepartmentHas(env,au,"academy.manage");
  const manage=manageDepartment && (au.master===true || (viewerRank && Number(viewerRank.level)>=2));
  const visibleTests=(tests||[]).filter(t=>manage || !Array.isArray(t.eligible_rank_ids) || !t.eligible_rank_ids.length || t.eligible_rank_ids.map(String).includes(String(viewerRank?.id||au.user.rank)));
  const safeTests=visibleTests.map(t=>({...t,questions:(Array.isArray(t.questions)?t.questions:[]).map(q=>manage?q:{id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]})}));
  return {department:au.department,manage,viewerRank:{id:viewerRank?.id||au.user.rank,name:viewerRank?.name||au.user.rank||"Kein Rang",level:Number(viewerRank?.level||0)},ranks:rankRowsData,documents:documents||[],tests:safeTests,results:(results||[]).map(r=>({...r,test_title:testMap.get(String(r.test_id))||"Prüfung"}))};
 }
 if(method==="academySaveDocument"){
  const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const d=args[1]||{},title=text(d.title),content=text(d.content);if(!title)throw new Error("Titel ist erforderlich.");
  const row={title,category:text(d.category)||"Ausbildung",description:text(d.description),content,active:d.active!==false,updated_at:new Date().toISOString()};let saved;
  if(text(d.id))saved=await db(env,"academy_documents",{method:"PATCH",query:{id:`eq.${text(d.id)}`,select:"*"},body:row,prefer:"return=representation"});
  else{const full={id:id("ACD"),...row,created_by:au.user.id,created_by_name:au.user.name,created_at:new Date().toISOString()};saved=await db(env,"academy_documents",{method:"POST",query:{select:"*"},body:full,prefer:"return=representation"});}
  return saved?.[0]||row;
 }
 if(method==="academyDeleteDocument"){
  const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const itemId=text(args[1]);if(!itemId)throw new Error("Dokument fehlt.");
  const rows=await db(env,"academy_documents",{query:{select:"id,file_path",id:`eq.${itemId}`,limit:"1"}});const filePath=rows?.[0]?.file_path;
  if(filePath){const {url,key}=config(env);await fetch(`${url}/storage/v1/object/academy-documents/${filePath}`,{method:"DELETE",headers:{apikey:key,Authorization:`Bearer ${key}`}}).catch(()=>{});}
  await db(env,"academy_documents",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});return {success:true};
 }
 if(method==="academyGetDocumentFile"){
  await academyAccess(env,token,"academy.view");const itemId=text(args[1]);const rows=await db(env,"academy_documents",{query:{select:"id,title,file_path,file_name,mime_type",id:`eq.${itemId}`,active:"eq.true",limit:"1"}});const doc=rows?.[0];if(!doc)throw Object.assign(new Error("Schulungsunterlage nicht gefunden."),{status:404});if(!doc.file_path)throw new Error("Diese Unterlage enthält keine importierte PDF-Datei.");const {url,key}=config(env);const signed=await fetch(`${url}/storage/v1/object/sign/academy-documents/${doc.file_path}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({expiresIn:3600})});const raw=await signed.text();let data={};try{data=JSON.parse(raw)}catch{}if(!signed.ok)throw Object.assign(new Error(data?.message||"Die PDF konnte nicht freigegeben werden."),{status:signed.status});const path=data.signedURL||data.signedUrl||data.url;if(!path)throw new Error("Keine gültige PDF-Freigabe erhalten.");return {url:path.startsWith("http")?path:`${url}/storage/v1${path}`};
 }
 if(method==="academySaveTest"){
  const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const d=args[1]||{},title=text(d.title),questions=Array.isArray(d.questions)?d.questions:[];if(!title||!questions.length)throw new Error("Titel und mindestens eine Frage sind erforderlich.");
  const cleanQuestions=questions.map((q,i)=>{const type=["single_choice","multiple_choice","true_false"].includes(text(q.type))?text(q.type):"single_choice";const options=(Array.isArray(q.options)?q.options:[]).map(text).filter(Boolean).slice(0,6);let correctAnswer=q.correctAnswer;let correctAnswers=Array.isArray(q.correctAnswers)?q.correctAnswers.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<options.length):[];if(type==="true_false"){return {id:text(q.id)||`Q${i+1}`,prompt:text(q.prompt),type,options:["Richtig","Falsch"],correctAnswer:String(correctAnswer)==="false"?"false":"true"};}if(type==="multiple_choice"){if(!correctAnswers.length)correctAnswers=[Math.max(0,Math.min(options.length-1,Number(correctAnswer)||0))];return {id:text(q.id)||`Q${i+1}`,prompt:text(q.prompt),type,options,correctAnswers:[...new Set(correctAnswers)].sort((a,b)=>a-b)};}return {id:text(q.id)||`Q${i+1}`,prompt:text(q.prompt),type,options,correctAnswer:Math.max(0,Math.min(options.length-1,Number(correctAnswer)||0))};}).filter(q=>q.prompt&&((q.type==="true_false")||(q.options.length>=2)));
  if(!cleanQuestions.length)throw new Error("Die Prüfung enthält keine gültigen Fragen.");
  const eligibleRankIds=[...new Set((Array.isArray(d.eligibleRankIds)?d.eligibleRankIds:[]).map(text).filter(Boolean))];
  if(!eligibleRankIds.length)throw new Error("Bitte mindestens einen berechtigten Rang auswählen.");
  const row={title,category:text(d.category)||"Qualifikation",description:text(d.description),eligible_rank_ids:eligibleRankIds,passing_score:Math.max(1,Math.min(100,Number(d.passingScore)||70)),questions:cleanQuestions,active:d.active!==false,updated_at:new Date().toISOString()};let saved;
  if(text(d.id))saved=await db(env,"academy_tests",{method:"PATCH",query:{id:`eq.${text(d.id)}`,select:"*"},body:row,prefer:"return=representation"});
  else{const full={id:id("ACT"),...row,created_by:au.user.id,created_by_name:au.user.name,created_at:new Date().toISOString()};saved=await db(env,"academy_tests",{method:"POST",query:{select:"*"},body:full,prefer:"return=representation"});}
  return saved?.[0]||row;
 }
 if(method==="academyDeleteTest"){const au=await academyAccess(env,token,"academy.manage"); const academyRanks=await rankRows(env); const academyViewerRank=academyRanks.find(r=>String(r.id)===String(au.user.rank))||academyRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(academyViewerRank?.level||0)<2)throw Object.assign(new Error("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet."),{status:403}); const itemId=text(args[1]);if(!itemId)throw new Error("Prüfung fehlt.");await db(env,"academy_tests",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});return {success:true};}
 if(method==="academyGetTestForAttempt"){
  await academyAccess(env,token,"academy.test");const testId=text(args[1]);const tests=await db(env,"academy_tests",{query:{select:"id,title,category,description,passing_score,questions,eligible_rank_ids,active",id:`eq.${testId}`,active:"eq.true",limit:"1"}});const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404}); const attemptRanks=await rankRows(env); const attemptRank=attemptRanks.find(r=>String(r.id)===String(au.user.rank))||attemptRanks.find(r=>String(r.name)===String(au.user.rank)); const allowed=Array.isArray(test.eligible_rank_ids)?test.eligible_rank_ids.map(String):[]; if(allowed.length&&!allowed.includes(String(attemptRank?.id||au.user.rank)))throw Object.assign(new Error("Dein Rang ist für diesen Test nicht berechtigt."),{status:403}); const questions=(Array.isArray(test.questions)?test.questions:[]).map(q=>({id:q.id,prompt:q.prompt,type:q.type,options:q.options||[]}));return {...test,questions};
 }
 if(method==="academySubmitTest"){
  const au=await academyAccess(env,token,"academy.test"),testId=text(args[1]),answers=Array.isArray(args[2])?args[2]:[];const tests=await db(env,"academy_tests",{query:{select:"id,title,passing_score,questions,eligible_rank_ids,active",id:`eq.${testId}`,active:"eq.true",limit:"1"}});const test=tests?.[0];if(!test)throw Object.assign(new Error("Prüfung nicht gefunden."),{status:404}); const submitRanks=await rankRows(env); const submitRank=submitRanks.find(r=>String(r.id)===String(au.user.rank))||submitRanks.find(r=>String(r.name)===String(au.user.rank)); const allowedSubmit=Array.isArray(test.eligible_rank_ids)?test.eligible_rank_ids.map(String):[]; if(allowedSubmit.length&&!allowedSubmit.includes(String(submitRank?.id||au.user.rank)))throw Object.assign(new Error("Dein Rang ist für diesen Test nicht berechtigt."),{status:403});
  const qs=Array.isArray(test.questions)?test.questions:[];if(answers.length!==qs.length)throw new Error("Die Prüfung wurde nicht vollständig beantwortet.");let correct=0;
  qs.forEach((q,i)=>{const a=answers[i];if(q.type==="multiple_choice"){const got=(Array.isArray(a)?a:[]).map(Number).sort((x,y)=>x-y),want=(Array.isArray(q.correctAnswers)?q.correctAnswers:[]).map(Number).sort((x,y)=>x-y);if(JSON.stringify(got)===JSON.stringify(want))correct++;}else if(q.type==="true_false"){if(String(a)===String(q.correctAnswer))correct++;}else if(Number(a)===Number(q.correctAnswer))correct++;});
  const score=qs.length?Math.round(correct/qs.length*100):0,passed=score>=Number(test.passing_score||70);const row={id:id("ACA"),test_id:test.id,user_id:au.user.id,user_name:au.user.name,score,passed,answers,submitted_at:new Date().toISOString()};await db(env,"academy_attempts",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return {success:true,score,passed,correct,total:qs.length};
 }
}

async function internalFineDispatch(method,args,env,token){
 if(!["getInternalSanctionsOverview","getInternalFineCatalog","saveInternalFineCatalogItem","deleteInternalFineCatalogItem","getInternalFinePersonnel","createInternalFineCase","getInternalFineCases"].includes(method))return undefined;
 const view=()=>authz(env,token,"ifines.view");
 const sanctionTypes=["fine","hq_rounds","fort_rounds","human_labs","suspension","termination"];
 const sanctionLabel=type=>({fine:"Geldstrafe",hq_rounds:"HQ-Runden",fort_rounds:"Fort-Runden",human_labs:"Human Labs",suspension:"Suspendierung",termination:"Kündigung"}[type]||"Sanktion");
 if(method==="getInternalSanctionsOverview"){
  const au=await view();
  const query={select:"id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,created_by",order:"sort_order.asc,title.asc",limit:"1000"};
  if(!au.master)query.active="eq.true";
  const rows=await db(env,"fib_internal_fine_catalog",{query});
  return {canManage:au.master===true,canIssue:effectivePermission(au,"ifines.manage"),items:(rows||[]).map(r=>({...r,item_type:r.item_type==="fine"?"sanction":r.item_type,sanction_type:r.sanction_type||(r.item_type==="fine"?"fine":null)}))};
 }
 if(method==="getInternalFineCatalog"){
  const au=await view();if(!au.master)throw Object.assign(new Error("Die Katalogverwaltung ist ausschließlich Master-Benutzern vorbehalten."),{status:403});
  const rows=await db(env,"fib_internal_fine_catalog",{query:{select:"id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,updated_at",order:"sort_order.asc,title.asc",limit:"1000"}});
  return (rows||[]).map(r=>({...r,item_type:r.item_type==="fine"?"sanction":r.item_type,sanction_type:r.sanction_type||(r.item_type==="fine"?"fine":null)}));
 }
 if(method==="getInternalFinePersonnel"){
  await view();
  const [users,people,ranks]=await Promise.all([
   db(env,"users",{query:{select:"id,name,rank,active,approved",active:"eq.true",approved:"eq.true",order:"name.asc"}}),
   db(env,"personnel",{query:{select:"user_id,service_number,call_sign,department,unit,personnel_status"}}),rankRows(env)
  ]);
  const peopleByUserId=new Map((people||[]).map(p=>[String(p.user_id),p]));
  const ranksById=new Map((ranks||[]).map(r=>[String(r.id),r]));
  const ranksByName=new Map((ranks||[]).map(r=>[String(r.name),r]));
  return (users||[]).map(u=>{const p=peopleByUserId.get(String(u.id))||{};const r=ranksById.get(String(u.rank))||ranksByName.get(String(u.rank));return {id:u.id,name:u.name,rank:r?.name||u.rank||"Kein Rang",serviceNumber:p.service_number||"",callSign:p.call_sign||"",department:p.department||"",unit:p.unit||"",personnelStatus:p.personnel_status||""};});
 }
 if(method==="getInternalFineCases"){
  await view();
  const rows=await db(env,"fib_internal_fines",{query:{select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at",order:"created_at.desc",limit:"300"}});
  return (rows||[]).filter(r=>r.metadata?.record_type==="internal_fine_case").map(normalizeModuleRow);
 }
 if(method==="saveInternalFineCatalogItem"){
  const au=await authz(env,token),d=args[1]||{},itemType=text(d.itemType||d.item_type);
  if(!au.master)throw Object.assign(new Error("Nur Master-Benutzer dürfen den Sanktionskatalog verwalten."),{status:403});
  if(!["category","sanction","fine"].includes(itemType))throw new Error("Ungültiger Katalogeintrag.");
  const title=text(d.title);if(!title)throw new Error("Eine Bezeichnung ist erforderlich.");
  const row={item_type:itemType==="category"?"category":"sanction",title,description:text(d.description),active:d.active!==false,sort_order:Number.isFinite(Number(d.sortOrder))?Number(d.sortOrder):0,updated_at:new Date().toISOString()};
  if(itemType!=="category"){
   const type=text(d.sanctionType||d.sanction_type||"fine");if(!sanctionTypes.includes(type))throw new Error("Ungültige Sanktionsart.");
   row.category_id=text(d.categoryId||d.category_id);if(!row.category_id)throw new Error("Bitte eine Kategorie auswählen.");
   const inputComponents=Array.isArray(d.components)?d.components:[];
   const components=(inputComponents.length?inputComponents:[{type,amount:d.amount,value:d.sanctionValue,unit:d.sanctionUnit}]).map(c=>{
    const ct=text(c.type||c.sanctionType||"fine");if(!sanctionTypes.includes(ct))throw new Error("Eine Sanktion enthält eine ungültige Maßnahmenart.");
    const out={type:ct,label:sanctionLabel(ct)};
    if(ct==="fine"){out.amount=Number(c.amount);if(!Number.isFinite(out.amount)||out.amount<0)throw new Error("Bitte für jede Geldstrafe einen gültigen Betrag eingeben.");}
    else if(["hq_rounds","fort_rounds","human_labs","suspension"].includes(ct)){out.value=Number(c.value??c.sanctionValue);if(!Number.isFinite(out.value)||out.value<=0)throw new Error("Bitte für jede Maßnahme einen Umfang größer als 0 eingeben.");out.unit=text(c.unit||c.sanctionUnit)||({hq_rounds:"Runden",fort_rounds:"Runden",human_labs:"Durchläufe",suspension:"Tage"}[ct]);}
    return out;
   });
   if(components.some(c=>c.type==="termination")&&components.length>1)throw new Error("Eine Kündigung kann nicht mit weiteren Maßnahmen kombiniert werden.");
   if(/rassism|rassistisch|rassistische/i.test(title+" "+text(d.description))&&!(components.length===1&&components[0].type==="termination"))throw new Error("Rassistische oder rassistische Äußerungen müssen als alleinige Kündigung konfiguriert werden.");
   row.sanction_components=components;row.amount=null;row.sanction_value=null;row.sanction_unit="";
   if(components.length===1){const c=components[0];row.sanction_type=c.type;if(c.type==="fine")row.amount=c.amount;else if(c.value!=null){row.sanction_value=c.value;row.sanction_unit=c.unit||"";}}
   else row.sanction_type="composite";
  }else{row.category_id=null;row.amount=null;row.sanction_type=null;row.sanction_value=null;row.sanction_unit="";row.sanction_components=[];}
  let saved;
  if(text(d.id)) saved=await db(env,"fib_internal_fine_catalog",{method:"PATCH",query:{id:`eq.${text(d.id)}`,select:"id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,created_by,updated_at"},body:row,prefer:"return=representation"});
  else {row.id=id("IFC");row.created_at=new Date().toISOString();row.created_by=au.user.id;saved=await db(env,"fib_internal_fine_catalog",{method:"POST",query:{select:"id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,created_by,updated_at"},body:row,prefer:"return=representation"});}
  return saved?.[0]||row;
 }
 if(method==="deleteInternalFineCatalogItem"){
  const au=await authz(env,token),itemId=text(args[1]);if(!au.master)throw Object.assign(new Error("Nur Master-Benutzer dürfen den Sanktionskatalog verwalten."),{status:403});if(!itemId)throw new Error("Eintrag fehlt.");
  const found=await db(env,"fib_internal_fine_catalog",{query:{select:"id,item_type",id:`eq.${itemId}`,limit:"1"}});if(!found?.length)throw Object.assign(new Error("Katalogeintrag nicht gefunden."),{status:404});
  if(found[0].item_type==="category") {const linked=await db(env,"fib_internal_fine_catalog",{query:{select:"id",category_id:`eq.${itemId}`,limit:"1"}});if(linked?.length)throw new Error("Die Kategorie enthält noch Sanktionen. Bitte zuerst diese verschieben oder entfernen.");}
  await db(env,"fib_internal_fine_catalog",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});return {success:true};
 }
 if(method==="createInternalFineCase"){
  const au=await authz(env,token,"ifines.manage"),d=args[1]||{},personId=text(d.personnelId),fineId=text(d.fineId||d.sanctionId);if(!personId||!fineId)throw new Error("Bitte Beamten und Sanktion auswählen.");
  const [catalog,users,people,ranks]=await Promise.all([
   db(env,"fib_internal_fine_catalog",{query:{select:"id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,created_by,updated_at",id:`eq.${fineId}`,item_type:"in.(sanction,fine)",active:"eq.true",limit:"1"}}),
   db(env,"users",{query:{select:"id,name,rank",id:`eq.${personId}`,limit:"1"}}),
   db(env,"personnel",{query:{select:"user_id,service_number,call_sign,department,unit",user_id:`eq.${personId}`,limit:"1"}}),rankRows(env)
  ]);
  const item=catalog?.[0],user=users?.[0];if(!item||!user)throw new Error("Die ausgewählte Sanktion oder der Beamte ist nicht mehr verfügbar.");
  const type=item.sanction_type||(item.item_type==="fine"?"fine":""),title=item.title;
  const components=Array.isArray(item.sanction_components)&&item.sanction_components.length?item.sanction_components:[{type:type||"fine",label:sanctionLabel(type||"fine"),...(type==="fine"?{amount:Number(item.amount||0)}:{value:item.sanction_value??null,unit:item.sanction_unit||""})}];
  if(/rassism|rassistisch|rassistische/i.test(title+" "+text(item.description))&&!(components.length===1&&components[0].type==="termination"))throw new Error("Rassistische oder rassistische Äußerungen müssen zur Kündigung führen. Diese Sanktion ist im Katalog nicht korrekt konfiguriert.");
  const p=people?.[0]||{},rank=(ranks||[]).find(x=>String(x.id)===String(user.rank)||x.name===user.rank)?.name||user.rank||"Kein Rang";
  const now=new Date().toISOString(),idValue=id("IFB"),amount=components.length===1&&components[0].type==="fine"?Number(components[0].amount):null;
  const metadata={record_type:"internal_fine_case",fine_id:item.id,fine_title:title,sanction_type:components.length===1?components[0].type:"composite",sanction_label:components.map(c=>c.label||sanctionLabel(c.type)).join(" + "),amount,sanction_value:components.length===1?components[0].value??null:null,sanction_unit:components.length===1?components[0].unit||"":"",sanction_components:components,personnel_id:user.id,personnel_name:user.name,personnel_rank:rank,service_number:p.service_number||"",call_sign:p.call_sign||"",department:p.department||"",unit:p.unit||"",reason:text(d.reason),issued_by:au.user.id,issued_by_name:au.user.name};
  const row={id:idValue,title:`${sanctionLabel(type)}: ${title} – ${user.name}`,description:text(d.reason)||item.description||`Interne Sanktion: ${title}`,status:"active",event_date:now,metadata,created_by:au.user.id,created_by_name:au.user.name,created_at:now,updated_at:now};
  const saved=await db(env,"fib_internal_fines",{method:"POST",query:{select:"id,title,description,status,event_date,metadata,created_by,created_by_name,created_at,updated_at"},body:row,prefer:"return=representation"});await writePersonnelHistory(env,au,personId,"sanction_issued",`Interne Sanktion „${title}“ festgesetzt: ${components.map(c=>c.label||sanctionLabel(c.type)).join(" + ")}.`);return normalizeModuleRow(saved?.[0]||row);
 }
}

function canonicalRecordType(value){
 const t=text(value).toLowerCase();
 return t==="doc"?"ia":t==="director"?"highcommand":t;
}
const RECORD_BASES=Object.freeze({investigation:"records.investigations",report:"records.reports",ia:"records.ia",highcommand:"records.highcommand"});
const RECORD_TYPES=Object.freeze({investigation:["investigation"],report:["report"],ia:["ia","doc"],highcommand:["highcommand","director"]});
const RECORD_LIST_COLUMNS="id,case_number,type,title,subject,status,classification,summary,created_at,created_by,created_by_name,updated_at,updated_by,updated_by_name,archived_at";
const RECORD_DETAIL_COLUMNS=RECORD_LIST_COLUMNS+",content,archived_by,archived_by_name";
const recordError=(message,status=400)=>Object.assign(new Error(message),{status});
function effectivePermission(au,permission){return !!permission&&(au.master||((au.permissions.includes("*")||au.permissions.includes(permission))&&(!au.departmentScopedPermissions.includes(permission)||au.departmentPermissions.includes(permission))));}
function recordAllowed(au,type,action="view"){
 const canonical=canonicalRecordType(type);
 const base=Object.hasOwn(RECORD_BASES,canonical)?RECORD_BASES[canonical]:null;
 return !!base&&effectivePermission(au,"records.view")&&effectivePermission(au,base+".view")&&(action==="view"||effectivePermission(au,base+"."+action));
}
function visibleRecordTypes(au){return Object.keys(RECORD_BASES).filter(t=>recordAllowed(au,t)).flatMap(t=>RECORD_TYPES[t]);}
function normalizedRecord(r){return {...r,type:canonicalRecordType(r.type)};}
async function recordById(env,au,rid,action="view",columns="id,type,status,updated_at"){
 if(!rid)throw recordError("Akten-ID fehlt.");
 const types=visibleRecordTypes(au);
 if(!types.length)throw recordError("Keine Berechtigung für diese Akte.",403);
 const rows=await db(env,"fib_records",{query:{select:columns,id:`eq.${rid}`,type:`in.(${types.join(",")})`,limit:"1"}});
 const r=rows?.[0];
 if(!r||!recordAllowed(au,r.type,action))throw recordError("Akte nicht verfügbar oder keine Berechtigung.",403);
 return r;
}
function recordPatch(d,creating=false){
 const row={};
 for(const [k,max] of Object.entries({title:160,subject:160,summary:500,content:200000})){
  if(d[k]===undefined&&!creating)continue;
  const value=k==="content"?String(d[k]??""):text(d[k]);
  if(value.length>max)throw recordError(`Das Feld ${k} ist zu lang.`);
  if(k==="title"&&!value)throw recordError("Titel ist erforderlich.");
  row[k]=value;
 }
 if(d.status!==undefined||creating){const status=text(d.status)||"open";if(!["open","in_progress","closed"].includes(status))throw recordError("Ungültiger Status. Nutze zum Archivieren die Archivfunktion.");row.status=status;}
 return row;
}
// Share identical authorized count queries across users of one deployment. The
// aggregate snapshot remains user-scoped; no privileged data is reused for other scopes.
function dashboardQuery(env,key,fn,force=false){
 const cacheKey=JSON.stringify([env.SUPABASE_URL,key]);const old=dashboardQueryCache.get(cacheKey);
 if(old&&(old.pending||!force&&Date.now()-old.at<30000))return old.task;
 for(const [k,v] of dashboardQueryCache)if(!v.pending&&Date.now()-v.at>=30000)dashboardQueryCache.delete(k);
 if(dashboardQueryCache.size>=100)dashboardQueryCache.delete(dashboardQueryCache.keys().next().value);
 const entry={at:Date.now(),pending:true,task:null};
 entry.task=Promise.resolve().then(fn).then(value=>{entry.pending=false;entry.at=Date.now();return value;},error=>{if(dashboardQueryCache.get(cacheKey)===entry)dashboardQueryCache.delete(cacheKey);throw error;});
 dashboardQueryCache.set(cacheKey,entry);return entry.task;
}
async function dashboardStatistics(env,au,token,force=false){
 const types=visibleRecordTypes(au);
 const access={warrants:effectivePermission(au,"warrants.view"),wanted:effectivePermission(au,"wanted.view"),records:types.length>0,users:effectivePermission(au,"officers.view"),patrols:effectivePermission(au,"patrols.view"),announcements:effectivePermission(au,"announcements.view")};
 // The cache scope includes effective permissions and the user (the Sheets bridge is user-authenticated).
 const key=JSON.stringify([env.SUPABASE_URL,au.user.id,access,types]);const cached=dashboardStatsCache.get(key);
 if(!force&&cached&&Date.now()-cached.at<30000)return cached.task;
 for(const [k,v] of dashboardStatsCache)if(Date.now()-v.at>=30000)dashboardStatsCache.delete(k);
 const epoch=dashboardStatsEpoch;
 const safe=async(enabled,fn)=>{if(!enabled)return null;try{return await fn();}catch(e){console.warn("Dashboard-Teilabfrage fehlgeschlagen",e?.message);return null;}};
 const shared=(key,fn)=>dashboardQuery(env,key,fn,force);
 const task=(async()=>{
  const [openWarrants,activeWanted,openRecords,activeUsers,activePatrols,announcements,profileDepartment]=await Promise.all([
   safe(access.warrants,async()=>{const r=await googleSheetsCall(env,"getWarrantStatistics",[token],{timeoutMs:6500});const n=r?.open??r?.openWarrants??r?.activeWarrants;return n!=null&&Number.isFinite(Number(n))?Number(n):null;}),
   safe(access.wanted,()=>shared("wanted",()=>dbCount(env,"fib_wanted",{status:"not.in.(closed,Closed,resolved,Resolved,cancelled,Cancelled,inactive,Inactive,captured,Captured,archived,Archived)",or:`(expires_on.is.null,expires_on.gte.${new Date().toISOString().slice(0,10)})`}))),
   safe(access.records,()=>shared(["records",types],()=>dbCount(env,"fib_records",{type:`in.(${types.join(",")})`,status:"in.(open,in_progress)"}))),
   safe(access.users,()=>shared("users",()=>dbCount(env,"users",{active:"eq.true",approved:"eq.true"}))),
   safe(access.patrols,()=>shared("patrols",()=>dbCount(env,"patrols"))),
   safe(access.announcements,()=>shared("announcements",async()=>{const rows=await db(env,"fib_announcements",{query:{select:"id,title,description,event_date,created_at,metadata",status:"eq.active",order:"created_at.desc",limit:"4"}});return (rows||[]).map(r=>({id:r.id,title:r.title,description:String(r.description||"").slice(0,240),eventDate:r.event_date||r.created_at,important:r.metadata?.priority==="important"}));})),
   au.master?safe(true,async()=>text((await db(env,"personnel",{query:{select:"department",user_id:`eq.${au.user.id}`,limit:"1"}}))?.[0]?.department)||"Nicht zugeordnet"):Promise.resolve(au.department||"Nicht zugeordnet")
  ]);
  return {access,openWarrants,activeWanted,openRecords,activeUsers,activePatrols,announcements,profileDepartment,updatedAt:new Date().toISOString()};
 })();
 if(dashboardStatsCache.size>=100)dashboardStatsCache.delete(dashboardStatsCache.keys().next().value);
 if(epoch===dashboardStatsEpoch)dashboardStatsCache.set(key,{at:Date.now(),task});
 return task;
}
// Notifications: visibility is computed on the server, including department permissions.
async function notificationFeed(env,au){
 const categories=Object.entries({vacations:"vacations.view",bonuses:"bonuses.view",training:"officers.view",announcements:"announcements.view"}).filter(([,perm])=>effectivePermission(au,perm)).map(([key])=>key);
 if(!categories.length)return [];
 const uid=String(au.user.id), select="id,recipient_id,category,title,message,page,created_at", order="created_at.desc,id.desc";
 const privateCategories=categories.filter(c=>c!=="announcements");
 const [own,shared]=await Promise.all([
  privateCategories.length?db(env,"fib_notifications",{query:{select,recipient_id:`eq.${uid}`,category:`in.(${privateCategories.join(",")})`,order,limit:"100"}}):[],
  categories.includes("announcements")?db(env,"fib_notifications",{query:{select,recipient_id:"is.null",category:"eq.announcements",order,limit:"100"}}):[]
 ]);
 return [...(own||[]),...(shared||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))).slice(0,100);
}
async function notificationDispatch(method,args,env,token){
 if(!["getNotifications","markNotificationsRead"].includes(method))return undefined;
 const au=await authz(env,token), uid=String(au.user.id), rows=await notificationFeed(env,au);
 if(method==="markNotificationsRead"){
  const requested=Array.isArray(args[1])?new Set(args[1].map(String)):new Set();
  const ids=rows.filter(r=>requested.has(String(r.id))).map(r=>r.id);
  if(ids.length)await db(env,"fib_notification_reads",{method:"POST",body:ids.map(notification_id=>({user_id:uid,notification_id})),prefer:"resolution=ignore-duplicates,return=minimal"});
  return {success:true};
 }
 const receipts=rows.length?await db(env,"fib_notification_reads",{query:{select:"notification_id",user_id:`eq.${uid}`,notification_id:`in.(${rows.map(r=>r.id).join(",")})`}}):[];
 const seen=new Set((receipts||[]).map(r=>String(r.notification_id)));
 const items=rows.map(({recipient_id,...r})=>({...r,read:seen.has(String(r.id))}));
 return {items,unread:items.filter(r=>!r.read).length};
}
function boloFields(d){
 const result={};for(const k of ["type","name","alias","person_id","plate","vehicle_model","vehicle_color","reason","danger_level","last_seen","description","notes","status"])if(d[k]!==undefined)result[k]=text(d[k]);
 for(const k of ["wanted_since","captured_at","expires_on"])if(d[k]!==undefined){const v=text(d[k]);if(v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))throw recordError("Ungültiges Datum.",400);result[k]=v||null;}
 if(d.armed!==undefined)result.armed=d.armed===true;
 if(d.image_url!==undefined){const v=text(d.image_url);if(v){try{if(new URL(v).protocol!=="https:")throw Error();}catch{throw recordError("Nur HTTPS-Bildlinks sind zulässig.",400);}}result.image_url=v||null;}
 if(result.name!==undefined&&!result.name)throw recordError("Name ist erforderlich.",400);
 if(result.expires_on&&result.wanted_since&&result.expires_on<result.wanted_since)throw recordError("Ablaufdatum liegt vor dem Startdatum.",400);
 if(result.type&&!['person','vehicle'].includes(result.type))throw recordError("Ungültige BOLO-Art.",400);
 if(result.status&&!['wanted','observation','captured'].includes(result.status.toLowerCase()))throw recordError("Ungültiger BOLO-Status.",400);
 if(result.danger_level&&!['low','medium','high','extreme'].includes(result.danger_level))throw recordError("Ungültige Gefahrenstufe.",400);
 return result;
}
async function dispatchCore(method,args,env,token){
 if(/classif(?:ication|ied)/i.test(method))throw Object.assign(new Error("Diese Funktion gehört nicht zum LSPD MDT."),{status:404});
 const regulation=await regulationDispatch(method,args,env,token,authz);if(regulation!==undefined)return regulation;
 const notice=await notificationDispatch(method,args,env,token);if(notice!==undefined)return notice;
 // These legacy reference modules remain live in their original Google Sheets.
 if(SHEET_BACKED_METHODS.has(method)){
  if(method==="getFines") await authz(env,token,"fines.view");
  else if(method==="getLawyers") await authz(env,token,"lawyers.view");
  else if(method==="getWarrants"||method==="getWarrantStatistics") await authz(env,token,"warrants.view");
  else if(method==="refreshWarrantsCache") await authz(env,token,"warrants.manage");
  else await authz(env,token);
  return await googleSheetsCall(env,method,args);
 }
 // Vehicle catalog: master-managed reference list for the Bureau.
 if(method==="getVehicleCatalog"){
  const au=await authz(env,token,"vehicles.view");
  const query={select:"id,name,vehicle_class,image_url,description,active,created_at,updated_at",order:"vehicle_class.asc,name.asc",limit:"500"};
  if(!au.master)query.active="eq.true";
  const items=await db(env,"fib_vehicle_catalog",{query});
  return {items:items||[],canManage:effectivePermission(au,"vehicles.manage")};
 }
 if(method==="saveVehicleCatalogItem"){
  const au=await authz(env,token,"vehicles.manage");
  const d=args[0]||{},name=text(d.name),vehicleClass=text(d.vehicleClass||d.vehicle_class),imageUrl=text(d.imageUrl||d.image_url);
  const allowed=["STR","STR (UM)","OFF","OFF (UM)","HSP","HSP (UM)","OVW"];
  if(!name)throw new Error("Bitte einen Fahrzeugnamen angeben.");
  if(!allowed.includes(vehicleClass))throw new Error("Bitte eine gültige Fahrzeugklasse auswählen.");
  if(imageUrl&&!/^https:\/\//i.test(imageUrl))throw new Error("Der Bildlink muss eine HTTPS-Adresse sein.");
  const row={name,vehicle_class:vehicleClass,image_url:imageUrl||null,description:text(d.description)||null,active:d.active!==false,updated_at:new Date().toISOString()};
  const itemId=text(d.id);
  const saved=itemId
   ? (await db(env,"fib_vehicle_catalog",{method:"PATCH",query:{id:`eq.${itemId}`,select:"id,name,vehicle_class,image_url,description,active,created_at,updated_at",},body:row,prefer:"return=representation"}))?.[0]
   : (await db(env,"fib_vehicle_catalog",{method:"POST",query:{select:"id,name,vehicle_class,image_url,description,active,created_at,updated_at"},body:{...row,id:id("VEH"),created_at:new Date().toISOString()},prefer:"return=representation"}))?.[0];
  return {success:true,item:saved||row};
 }
 if(method==="deleteVehicleCatalogItem"){
  const au=await authz(env,token,"vehicles.manage");
  const itemId=text(args[0]);if(!itemId)throw new Error("Fahrzeug-ID fehlt.");
  await db(env,"fib_vehicle_catalog",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});
  return {success:true};
 }
 // Auth / profile
 const noarg=args; const a=()=>authz(env,token);
 const equipmentResult=await equipmentDispatch(method,args,env,token);if(equipmentResult!==undefined)return equipmentResult;
 const uniformResult=await uniformDispatch(method,args,env,token); if(uniformResult!==undefined)return uniformResult;
 const academyResult=await academyDispatch(method,args,env,token); if(academyResult!==undefined)return academyResult;
 const internalFineResult=await internalFineDispatch(method,args,env,token); if(internalFineResult!==undefined)return internalFineResult;
 const financeResult=await financeDispatch(method,args,env,token); if(financeResult!==undefined)return financeResult;
 const vacationResult=await vacationDispatch(method,args,env,token); if(vacationResult!==undefined)return vacationResult;
 const moduleResult=await moduleDispatch(method,args,env,token); if(moduleResult!==undefined)return moduleResult;
 if(method==="getMyPermissions")return permissionsFor(env,await a());
 if(method==="getMyPersonnelProfile"){
  const au=await authz(env,token);
  const rows=await db(env,"personnel",{query:{select:"user_id,call_sign,personnel_status",user_id:`eq.${au.user.id}`,limit:"1"}});
  const row=rows?.[0]||{};
  return {userId:au.user.id,callSign:text(row.call_sign),personnelStatus:text(row.personnel_status)};
 }
 if(method==="getAllAgents"||method==="getPersonnelList"){
  await authz(env,token,"officers.view");
  const [users,people,ranks]=await Promise.all([
   db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",active:"eq.true",approved:"eq.true",order:"name.asc"}}),
   db(env,"personnel",{query:{select:"user_id,service_number,department,unit,call_sign,phone,email,address,entry_date,personnel_status,note"}}),
   rankRows(env)
  ]);
  const peopleBy=new Map((people||[]).map(p=>[String(p.user_id),p]));
  const ranksBy=new Map((ranks||[]).flatMap(r=>[[String(r.id),r],[String(r.name),r]]));
  return (users||[]).map(u=>{
   const p=normalizePersonnelRow(peopleBy.get(String(u.id))||{});
   const r=ranksBy.get(String(u.rank));
   return {...p,id:u.id,userId:u.id,username:u.username,name:u.name,rank:r?.name||u.rank||"Kein Rang",rankId:r?.id||u.rank||"",rankLevel:r?.level||0,active:u.active,approved:u.approved,profileImage:u.profile_image||p.profileImage||""};
  });
 }
 if(method==="getPersonnelRankOptions"){await authz(env,token,"officers.view");return await rankRows(env);}
 if(method==="getPersonnelTerminations") {
  const au=await authz(env,token,"officers.view");
  const rows=await db(env,"personnel_terminations",{query:{select:"id,user_id,document_number,payload,created_by_name,created_at",order:"created_at.desc",limit:"500"}});
  return (rows||[]).map(r=>({id:r.id,userId:r.user_id,documentNumber:r.document_number,publicToken:r.payload?.publicToken||"",payload:r.payload||{},createdByName:r.created_by_name||"System",createdAt:r.created_at||""}));
 }
 if(method==="getPersonnelFileBundle"||method==="getPersonnelFile"){
  const au=await authz(env,token,"officers.view");const uid=text(args[1]);if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const us=await db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",id:`eq.${uid}`,limit:"1"}});if(!us?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  const [pp,tt,nn,hh,tx,ranks]=await Promise.all([
   db(env,"personnel",{query:{select:"user_id,service_number,phone,call_sign,department,unit,email,address,entry_date,personnel_status,note",user_id:`eq.${uid}`,limit:"1"}}),
   db(env,"personnel_trainings",{query:{select:"*",user_id:`eq.${uid}`,order:"created_at.desc"}}),
   db(env,"personnel_notes",{query:{select:"id,user_id,type,title,content,created_by,created_by_name,created_at",user_id:`eq.${uid}`,order:"created_at.desc"}}),
   db(env,"personnel_history",{query:{select:"id,user_id,action,detail,actor_id,actor_name,created_at",user_id:`eq.${uid}`,order:"created_at.desc",limit:"300"}}).catch(()=>[]),
   db(env,"personnel_terminations",{query:{select:"id,user_id,document_number,payload,created_by_name,created_at",user_id:`eq.${uid}`,order:"created_at.desc",limit:"100"}}).catch(()=>[]),
   rankRows(env)
  ]);
  const u=us[0],p=normalizePersonnelRow(pp?.[0]||{}),rank=(ranks||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank);
  const viewerRank=(ranks||[]).find(r=>String(r.id)===String(au.user.rank)||r.name===au.user.rank);
  const canViewSanctions=au.master===true||!!(viewerRank&&rank&&Number(rank.level)<Number(viewerRank.level));
  const agent={...u,...p,rank:rank?.name||u.rank||"Kein Rang",rankId:rank?.id||u.rank||"",rankName:rank?.name||u.rank||"Kein Rang",profileImage:u.profile_image||p.profileImage||""};
  const sanctions=canViewSanctions?(await db(env,"fib_internal_fines",{query:{select:"id,title,description,status,event_date,metadata,created_at","metadata->>personnel_id":`eq.${uid}`,"metadata->>record_type":"eq.internal_fine_case",order:"created_at.desc",limit:"300"}})||[]).filter(r=>r.metadata?.record_type==="internal_fine_case").map(normalizeModuleRow):[];
  const terminations=(tx||[]).map(r=>({id:r.id,userId:r.user_id,documentNumber:r.document_number,publicToken:r.payload?.publicToken||"",payload:r.payload||{},createdByName:r.created_by_name||"System",createdAt:r.created_at||""}));
  return {agent,personnel:p,trainings:(tt||[]).map(normalizeTrainingRow),notes:(nn||[]).map(normalizePersonnelNoteRow),sanctions,sanctionsVisible:canViewSanctions,history:(hh||[]).filter(row=>canViewSanctions||row.action!=="sanction_issued"),terminations,rankOptions:ranks||[]};
 }
 if(method==="getPersonnelHistory"){
  const au=await authz(env,token,"officers.view");const uid=text(args[1]);if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const query={select:"id,user_id,action,detail,actor_id,actor_name,created_at",user_id:`eq.${uid}`,order:"created_at.desc",limit:"300"};
  if(!au.master){
   const [users,ranks]=await Promise.all([db(env,"users",{query:{select:"id,rank",id:`eq.${uid}`,limit:"1"}}),rankRows(env)]);
   const lookup=value=>ranks.find(r=>String(r.id)===String(value)||String(r.name)===String(value));
   const viewer=lookup(au.user.rank),target=lookup(users?.[0]?.rank);
   if(!(viewer&&target&&Number(target.level)<Number(viewer.level)))query.action="neq.sanction_issued";
  }
  const rows=await db(env,"personnel_history",{query});
  return (rows||[]).filter(r=>!query.action||r.action!=="sanction_issued");
 }
 if(method==="savePersonnelDepartment"){
  const au=await authz(env,token,"officers.edit"),uid=text(args[1]),department=text(args[2]);
  const user=await db(env,"users",{query:{select:"id",id:`eq.${uid}`,limit:"1"}});if(!user?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  const rows=await db(env,"personnel",{query:{select:"user_id,department",user_id:`eq.${uid}`,limit:"1"}});
  if(text(rows?.[0]?.department)!==department){
   if(rows?.length)await db(env,"personnel",{method:"PATCH",query:{user_id:`eq.${uid}`},body:{department},prefer:"return=minimal"});
   else await db(env,"personnel",{method:"POST",body:{user_id:uid,department},prefer:"return=minimal"});
   clearAuthCaches();await writePersonnelHistory(env,au,uid,"profile_updated","Geändert: Abteilung");
  }
  return {success:true,department};
 }
 if(method==="savePersonnelProfile"){
  const au=await authz(env,token,"officers.edit");const uid=text(args[1]),data=args[2]||{};if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const target=await db(env,"users",{query:{select:"id,rank",id:`eq.${uid}`,limit:"1"}});if(!target?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  const existingRows=await db(env,"personnel",{query:{select:"user_id,service_number,phone,call_sign,department,unit,email,address,entry_date,personnel_status,note",user_id:`eq.${uid}`,limit:"1"}});
  const before=existingRows?.[0]||{}; const oldRank=String(target[0].rank||""); const rankId=text(data.rankId);
  const labels={serviceNumber:"Dienstnummer",phone:"Telefon",callSign:"Callsign",department:"Abteilung",unit:"Einheit",email:"E-Mail",address:"Adresse",entryDate:"Eintrittsdatum",personnelStatus:"Personalstatus",note:"Personalnotiz",rankId:"Dienstgrad"};
  const values={serviceNumber:text(data.serviceNumber),phone:text(data.phone),callSign:text(data.callSign),department:text(data.department),unit:text(data.unit),email:text(data.email),address:text(data.address),entryDate:data.entryDate||null,personnelStatus:text(data.personnelStatus),note:text(data.note)};
  const changed=[]; const compare=(a,b)=>String(a??"")===String(b??"");
  const beforeMap={serviceNumber:before.service_number,phone:before.phone,callSign:before.call_sign,department:before.department,unit:before.unit,email:before.email,address:before.address,entryDate:before.entry_date,personnelStatus:before.personnel_status,note:before.note};
  for(const [key,label] of Object.entries(labels)){ if(key==="rankId") continue; if(!compare(beforeMap[key],values[key])) changed.push(label); }
  if(rankId && String(rankId)!==oldRank) changed.push("Dienstgrad");
  if(rankId&&rankId!==oldRank)await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`},body:{rank:rankId},prefer:"return=minimal"});
  const payload={user_id:uid,service_number:values.serviceNumber,phone:values.phone,call_sign:values.callSign,department:values.department,unit:values.unit,email:values.email,address:values.address,entry_date:values.entryDate,personnel_status:values.personnelStatus,note:values.note};
  if(existingRows?.length){if(changed.some(label=>label!=="Dienstgrad"))await db(env,"personnel",{method:"PATCH",query:{user_id:`eq.${uid}`},body:payload,prefer:"return=minimal"});}else await db(env,"personnel",{method:"POST",body:payload,prefer:"return=minimal"});
  if(changed.length){clearAuthCaches();}
  if(changed.length) await writePersonnelHistory(env,au,uid,rankId&&String(rankId)!==oldRank&&changed.length===1?"rank_changed":"profile_updated",`Geändert: ${changed.join(", ")}`);
  return {success:true,personnel:normalizePersonnelRow(payload)};
 }
 if(method==="getPersonnelTrainings"||method==="getPersonnelNotes"){
  await authz(env,token,"officers.view");const uid=text(args[1]);if(!uid)throw new Error("Keine Benutzer-ID angegeben.");const training=method==="getPersonnelTrainings",table=training?"personnel_trainings":"personnel_notes";const rows=await db(env,table,{query:{select:"*",user_id:`eq.${uid}`,order:"created_at.desc"}});return (rows||[]).map(training?normalizeTrainingRow:normalizePersonnelNoteRow);
 }
 if(method==="createPersonnelTraining"||method==="createPersonnelNote") {
  const au=await authz(env,token,"officers.edit");const uid=text(args[1]),d=args[2]||{};if(!uid)throw new Error("Keine Benutzer-ID angegeben.");const user=await db(env,"users",{query:{select:"id",id:`eq.${uid}`,limit:"1"}});if(!user?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});const now=new Date().toISOString();
  const training=method==="createPersonnelTraining";
  const row=training?{
   id:id("TR"),user_id:uid,name:text(d.name),category:text(d.category),date:d.date||null,instructor:text(d.instructor),status:text(d.status)||"Bestanden",expiry_date:d.expiryDate||d.expiry_date||null,notes:text(d.notes),created_by:au.user.id,created_at:now
  }:{id:id("NT"),user_id:uid,type:text(d.type)||"Vermerk",title:text(d.title),content:text(d.content),created_by:au.user.id,created_by_name:au.user.name,created_at:now};
  if(training&&!row.name)throw new Error("Bitte eine Bezeichnung für die Schulung angeben.");if(!training&&!row.title)throw new Error("Bitte einen Titel für den Vermerk angeben.");
  const rows=await db(env,training?"personnel_trainings":"personnel_notes",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});const saved=rows?.[0]||row;await writePersonnelHistory(env,au,uid,training?"training_created":"note_created",training?`Schulung „${row.name}“ hinzugefügt.`:`Vermerk „${row.title}“ hinzugefügt.`);return training?normalizeTrainingRow({...saved,created_by_name:saved.created_by_name||au.user.name}):normalizePersonnelNoteRow(saved);
 }
 if(method==="createPersonnelTermination"){
  const au=await authz(env,token,"officers.terminate");
  const uid=text(args[1]),d=args[2]||{};
  if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const required=["documentNumber","issueDate","issuingOffice","processedBy","recipient","previousRank","departmentUnit","terminationType","effectiveDate","decidingOffice","reason","approval","equipmentReturn","updatedAt"];
  if(!text(d.processedBy)) d.processedBy=au.user.name||au.user.username||"System";
  if(!text(d.issuerNameRank)) d.issuerNameRank=au.user.name||au.user.username||"System";
  for(const key of required)if(!text(d[key]))throw new Error(`Bitte fülle das Feld „${key}“ aus.`);
  const signature=text(d.issuerSignature); if(!signature)throw new Error("Die Unterschrift der kündigenden Person ist erforderlich.");
  if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/i.test(signature)||signature.length>180000)throw new Error("Die Signatur ist ungültig oder zu groß.");
  const userRows=await db(env,"users",{query:{select:"id,username,name,rank,active,approved",id:`eq.${uid}`,limit:"1"}});
  if(!userRows?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  if(String(au.user.id)===String(uid))throw Object.assign(new Error("Du kannst dich nicht selbst kündigen."),{status:403,code:"SELF_TERMINATION_FORBIDDEN"});
  const ranks=await rankRows(env);
  const actorRank=ranks.find(r=>String(r.id)===String(au.user.rank)||String(r.name)===String(au.user.rank));
  const targetRank=ranks.find(r=>String(r.id)===String(userRows[0].rank)||String(r.name)===String(userRows[0].rank));
  if(!au.master){
    if(!actorRank)throw Object.assign(new Error("Dein eigener Dienstgrad konnte nicht eindeutig bestimmt werden."),{status:403,code:"ACTOR_RANK_UNKNOWN"});
    if(targetRank&&Number(targetRank.level)>Number(actorRank.level))throw Object.assign(new Error("Du kannst keine Person kündigen, die im Rang über dir steht."),{status:403,code:"HIGHER_RANK_TERMINATION_FORBIDDEN"});
  }
  const people=await db(env,"personnel",{query:{select:"user_id,service_number,department,unit,personnel_status",user_id:`eq.${uid}`,limit:"1"}});
  const p=people?.[0]||{};
  const raw=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join("");
  const now=new Date().toISOString();
  const payload={
    documentNumber:text(d.documentNumber),issueDate:text(d.issueDate),issuingOffice:text(d.issuingOffice),processedBy:text(d.processedBy),recipient:text(d.recipient),
    confidentiality:"Vertraulich – Personal",previousRank:text(d.previousRank),departmentUnit:text(d.departmentUnit),
    terminationType:text(d.terminationType),effectiveDate:text(d.effectiveDate),decidingOffice:text(d.decidingOffice),reason:text(d.reason),approval:text(d.approval),equipmentReturn:text(d.equipmentReturn),updatedAt:text(d.updatedAt),
    issuerNameRank:text(d.issuerNameRank),issuerSignature:signature
  };
  payload.publicToken=raw;
  const row={id:id("BE"),user_id:uid,document_number:payload.documentNumber,public_token_hash:await sha256(raw),payload,created_by:au.user.id,created_by_name:au.user.name,created_at:now};
  const saved=await db(env,"personnel_terminations",{method:"POST",query:{select:"id,user_id,document_number,created_by_name,created_at",},body:row,prefer:"return=representation"});
  await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`},body:{active:false,approved:false},prefer:"return=minimal"});
  const existing=people?.[0];
  if(existing)await db(env,"personnel",{method:"PATCH",query:{user_id:`eq.${uid}`},body:{personnel_status:"Ausgeschieden"},prefer:"return=minimal"});
  else await db(env,"personnel",{method:"POST",body:{user_id:uid,department:p.department||payload.departmentUnit,unit:p.unit||"",personnel_status:"Ausgeschieden"},prefer:"return=minimal"});
  await writePersonnelHistory(env,au,uid,"termination_created",`Dienstverhältnis beendet. Dokument ${payload.documentNumber}. Grund: ${payload.reason}`);
  clearAuthCaches();
  return {success:true,documentNumber:payload.documentNumber,url:`/?terminationShare=${raw}`,createdAt:now,termination:{id:row.id,userId:uid,documentNumber:payload.documentNumber,publicToken:raw,payload,createdByName:au.user.name||"System",createdAt:now}};
 }
 if(method==="deletePersonnelTraining"||method==="deletePersonnelNote"){const au=await authz(env,token,"officers.edit");const uid=text(args[1]),entryId=text(args[2]),training=method==="deletePersonnelTraining",table=training?"personnel_trainings":"personnel_notes";const found=await db(env,table,{query:{select:training?"id,name":"id,title",id:`eq.${entryId}`,user_id:`eq.${uid}`,limit:"1"}});await db(env,table,{method:"DELETE",query:{id:`eq.${entryId}`,user_id:`eq.${uid}`},prefer:"return=minimal"});const label=found?.[0]?(training?found[0].name:found[0].title):entryId;await writePersonnelHistory(env,au,uid,training?"training_deleted":"note_deleted",training?`Schulung „${label}“ gelöscht.`:`Vermerk „${label}“ gelöscht.`);return {success:true};}
 // patrols
 if(method==="getPatrolDutyConfig"){
  await authz(env,token,"patrols.view");
  const defaults={
   tenCodes:["10-1","10-3","10-6","10-23","10-76"],
   locations:["LS - City","LS - County","Roxwood County","Highway - East","Highway - West","Highway - City","Highway - Allgemein","Vespucci PD","Paleto SO","Sandy Shores SO","Roxwood SO","Border Station","City Hall","Staatsgefängnis","Police Academy","Krankenhaus","Air Support","Ermittlung","SWAT","Gang Unit","LS - City - Blitz"],
   activities:["Streifenfahrt","Feierabend","Juwelier","Geiselnahme","Raubüberfall","Großschadenslage","Großevent","Beschäftigt","Beschäftigt AD","Ausbildung / Übung","Besprechung","Code-PEE","Transport","Tätigkeitsbearbeitung","Durchsuchung","OOV"],
   vehicles:["STR","STR (UM)","OFF","OFF (UM)","HSP","HSP (UM)","OVW"],
   tenCodeColors:{},
   statusColors:{}
  };
  try{
   const rows=await db(env,"patrol_duty_settings",{query:{select:"ten_codes,locations,activities,vehicles,ten_code_colors,status_colors",id:"eq.DEFAULT",limit:"1"}});
   const row=rows?.[0]||{};
   const cleanList=(value,fallback)=>{if(!Array.isArray(value))return fallback;const out=[...new Set(value.map(v=>String(v).trim()).filter(Boolean))];return out.length?out:fallback;};
   return {success:true,
    tenCodes:cleanList(row.ten_codes,defaults.tenCodes),
    locations:cleanList(row.locations,defaults.locations),
    activities:cleanList(row.activities,defaults.activities),
    vehicles:cleanList(row.vehicles,defaults.vehicles),
    tenCodeColors:row.ten_code_colors&&typeof row.ten_code_colors==="object"&&!Array.isArray(row.ten_code_colors)?row.ten_code_colors:defaults.tenCodeColors,
    statusColors:row.status_colors&&typeof row.status_colors==="object"&&!Array.isArray(row.status_colors)?row.status_colors:defaults.statusColors
   };
  }catch(error){
   // The optional configuration table is intentionally non-critical: duty remains usable with built-in defaults.
   return {success:true,...defaults};
  }
 }
 if(method==="getPatrolTenCodes"){
  await authz(env,token,"patrols.view");
  const defaults=["10-1","10-3","10-6","10-23","10-76"];
  try{
   const rows=await db(env,"patrol_ten_code_settings",{query:{select:"codes",id:"eq.DEFAULT",limit:"1"}});
   const codes=Array.isArray(rows?.[0]?.codes)?rows[0].codes.map(v=>String(v).trim()).filter(Boolean):[];
   return {success:true,codes:[...new Set(codes.length?codes:defaults)]};
  }catch(error){
   // Older installations may not have the optional settings table yet.
   // Duty operation must still work with the built-in defaults.
   return {success:true,codes:defaults};
  }
 }
 if(method==="savePatrolTenCodes"){
  const au=await authz(env,token,"patrols.edit");
  if(!au.master)throw Object.assign(new Error("Nur ein Master darf die globalen Ten Codes konfigurieren."),{status:403});
  const raw=Array.isArray(args[1])?args[1]:(Array.isArray(args[0])?args[0]:[]);
  const codes=[...new Set(raw.map(v=>String(v).trim()).filter(Boolean))].slice(0,100);
  if(!codes.length)throw new Error("Mindestens ein Ten Code muss vorhanden sein.");
  const now=new Date().toISOString();
  try{
   await db(env,"patrol_ten_code_settings",{method:"POST",body:{id:"DEFAULT",codes,updated_at:now,updated_by:au.user.id},prefer:"resolution=merge-duplicates,return=minimal"});
  }catch(error){
   throw Object.assign(new Error("Die globalen Ten Codes konnten nicht gespeichert werden. Bitte führe zuerst die Migration migration_patrol_ten_code_settings_v34.sql aus."),{status:500,code:"TEN_CODE_SETTINGS_MIGRATION_REQUIRED"});
  }
  return {success:true,codes};
 }
 // One authenticated synchronization request for both the global duty bar and dispatch.
 // Dispatch snapshots reuse the same rows for the member's own patrol and the revision.
 if(method==="getPatrolSync"){
  const au=await authz(env,token,"patrols.view"), options=args[1]||{}, dispatch=options.dispatch===true, profile=options.profile===true;
  const columns="id,callsign,vehicle_type,ten_code,status,location,activity,updated_at,created_at";
  const profileTask=()=>profile?db(env,"personnel",{query:{select:"call_sign",user_id:`eq.${au.user.id}`,limit:"1"}}):Promise.resolve(null);
  let patrol=null,revision=null,count=null;
  if(dispatch){
   const [rows,members]=await Promise.all([
    db(env,"patrols",{query:{select:columns,order:"id.asc"}}),
    db(env,"patrol_members",{query:{select:"patrol_id,user_id,position",order:"patrol_id.asc,user_id.asc"}})
   ]);
   const all=rows||[], crew=members||[], mine=crew.find(m=>String(m.user_id)===String(au.user.id));
   patrol=mine?all.find(p=>String(p.id)===String(mine.patrol_id))||null:null;
   // Include actual values as well as timestamps, so even direct DB changes are detected.
   revision=await sha256(JSON.stringify([all,crew]));count=all.length;
  }else{
   const members=await db(env,"patrol_members",{query:{select:"patrol_id",user_id:`eq.${au.user.id}`,limit:"1"}});
   if(members?.length)patrol=(await db(env,"patrols",{query:{select:columns,id:`eq.${members[0].patrol_id}`,limit:"1"}}))?.[0]||null;
  }
  const people=await profileTask();
  return {success:true,patrol,revision,count,...(profile?{callSign:text(people?.[0]?.call_sign)}:{})};
 }
 if(method==="getOwnDuty"){
  const au=await authz(env,token,"patrols.view");
  const [members,people]=await Promise.all([
   db(env,"patrol_members",{query:{select:"patrol_id",user_id:`eq.${au.user.id}`,limit:"1"}}),
   db(env,"personnel",{query:{select:"call_sign",user_id:`eq.${au.user.id}`,limit:"1"}})
  ]);
  const callSign=text(people?.[0]?.call_sign);
  const rows=members?.length?await db(env,"patrols",{query:{select:"id,callsign,vehicle_type,ten_code,status,location,activity",id:`eq.${members[0].patrol_id}`,limit:"1"}}):[];
  return {success:true,callSign,patrol:rows?.[0]||null};
 }
 if(method==="updateOwnDuty"){
  const au=await authz(env,token,"patrols.view"),d=args[1]||{};
  const columns={location:"location",activity:"activity",vehicleType:"vehicle_type",tenCode:"ten_code"};
  const key=String(d.field||""),value=text(d.value);
  if(!Object.hasOwn(columns,key)||!value)throw Object.assign(new Error("Ungültige Dienstauswahl."),{status:400});
  const mine=await db(env,"patrol_members",{query:{select:"patrol_id",user_id:`eq.${au.user.id}`,limit:"1"}});
  if(!mine?.length)throw Object.assign(new Error("Du bist nicht im Dienst."),{status:409});
  const rows=await db(env,"patrols",{method:"PATCH",query:{id:`eq.${mine[0].patrol_id}`,select:"id,callsign,vehicle_type,ten_code,status,location,activity"},body:{[columns[key]]:value,updated_at:new Date().toISOString(),updated_by:au.user.id},prefer:"return=representation"});
  if(!rows?.length)throw Object.assign(new Error("Die Streife existiert nicht mehr."),{status:409});
  return {success:true,patrol:rows[0]};
 }
 if(method==="startDuty"){
  const au=await authz(env,token,"patrols.view");
  const d=args[1]||{};
  const location=text(d.location),activity=text(d.activity),vehicleType=text(d.vehicleType),tenCode=text(d.tenCode||d.ten_code||"10-1")||"10-1";
  if(!location||!activity||!vehicleType)throw new Error("Einsatzort, Status und Fahrzeug sind erforderlich.");
  const existingMembers=await db(env,"patrol_members",{query:{select:"patrol_id,position",user_id:`eq.${au.user.id}`}});
  if(existingMembers?.length){
   const existingId=String(existingMembers[0].patrol_id);
   const existing=await db(env,"patrols",{query:{select:"id,callsign,number,vehicle_type,status,ten_code,location,activity,created_at,created_by,updated_at,updated_by",id:`eq.${existingId}`,limit:"1"}});
   if(existing?.length){
    const row=existing[0];
    return {success:true,patrol:{...row,vehicleType:row.vehicle_type,tenCode:row.ten_code||row.status},alreadyOnDuty:true};
   }
  }
  const people=await db(env,"personnel",{query:{select:"user_id,call_sign",user_id:`eq.${au.user.id}`,limit:"1"}});
  const callsign=text(people?.[0]?.call_sign);
  if(!callsign)throw new Error("Bitte hinterlege zuerst dein Callsign in deiner Personalakte.");
  const now=new Date().toISOString(),pid=id("P");
  const row={id:pid,callsign,number:callsign,vehicle_type:vehicleType,status:"10-1",ten_code:tenCode,location,activity,created_at:now,created_by:au.user.id,updated_at:now,updated_by:au.user.id};
  await db(env,"patrols",{method:"POST",body:row,prefer:"return=minimal"});
  try{
   await db(env,"patrol_members",{method:"POST",body:{patrol_id:pid,user_id:au.user.id,position:"Lead"},prefer:"return=minimal"});
  }catch(error){
   await db(env,"patrols",{method:"DELETE",query:{id:`eq.${pid}`},prefer:"return=minimal"}).catch(()=>{});
   throw error;
  }
  return {success:true,patrol:{...row,tenCode:tenCode,vehicleType:vehicleType,members:[{id:au.user.id,name:au.user.name,username:au.user.username,rank:au.user.rank,callSign:callsign,position:"Lead"}]}};
 }
 if(method==="getPatrolRevision"){
  await authz(env,token,"patrols.view");
  const [rows,members]=await Promise.all([
   db(env,"patrols",{query:{select:"id,updated_at,created_at",order:"id.asc"}}),
   db(env,"patrol_members",{query:{select:"patrol_id,user_id,position",order:"patrol_id.asc,user_id.asc"}})
  ]);
  const list=Array.isArray(rows)?rows:[];
  const revision=JSON.stringify([list,(members||[])]);
  return {count:list.length,revision};
 }
 if(method==="getPatrols"){
  await authz(env,token,"patrols.view");const [ps,ms]=await Promise.all([
   db(env,"patrols",{query:{select:"id,callsign,number,vehicle_type,status,ten_code,location,activity,created_at,created_by,updated_at,updated_by",order:"updated_at.desc,created_at.desc"}}),db(env,"patrol_members",{query:{select:"patrol_id,user_id,position"}})
  ]);
  if(!ps?.length)return [];
  const activeIds=[...new Set((ms||[]).map(m=>String(m.user_id)).filter(Boolean))];
  const [us,rs,people]=activeIds.length?await Promise.all([
   db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",id:`in.(${activeIds.join(",")})`}}),rankRows(env),
   db(env,"personnel",{query:{select:"user_id,call_sign,service_number,personnel_status,department,unit",user_id:`in.(${activeIds.join(",")})`}})
  ]):[[],[],[]];
  const usersById=new Map((us||[]).map(u=>[String(u.id),u]));
  const peopleByUserId=new Map((people||[]).map(p=>[String(p.user_id),p]));
  const ranksById=new Map((rs||[]).map(r=>[String(r.id),r]));
  const ranksByName=new Map((rs||[]).map(r=>[String(r.name),r]));
  const membersByPatrol=new Map();
  for(const m of (ms||[])){const key=String(m.patrol_id);const list=membersByPatrol.get(key);if(list)list.push(m);else membersByPatrol.set(key,[m]);}
  return (ps||[]).map(p=>{
   const members=(membersByPatrol.get(String(p.id))||[]).map(m=>{const u=usersById.get(String(m.user_id))||{};const person=peopleByUserId.get(String(m.user_id))||{};const r=ranksById.get(String(u.rank))||ranksByName.get(String(u.rank));return {id:u.id,name:u.name,username:u.username,rank:r?.name||u.rank||"Kein Rang",rankShortName:r?.short_name||r?.shortName||r?.name||u.rank||"Kein Rang",rankId:r?.id||u.rank,profileImage:u.profile_image||"",callSign:text(person.call_sign),serviceNumber:patrolServiceNumber(person),department:text(person.department),unit:text(person.unit),position:m.position||"Member"};});
   const lead=members.find(m=>String(m.position||"").toLowerCase()==="lead")||members[0];
   return {...p,callsign:pickPrimaryPatrolCallsign(members)||text(p.callsign)||text(lead?.callSign),tenCode:p.ten_code||p.status,vehicleType:p.vehicle_type,members};
  });
 }
 if(method==="getPatrolEligibleUsers"){
  await authz(env,token,"patrols.view");const [us,ms,rs,people]=await Promise.all([
   db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",active:"eq.true",approved:"eq.true",order:"name.asc"}}),
   db(env,"patrol_members",{query:{select:"user_id"}}),rankRows(env),
   db(env,"personnel",{query:{select:"user_id,call_sign,service_number,personnel_status,department,unit"}})
  ]);const busy=new Set((ms||[]).map(m=>String(m.user_id)));const peopleByUserId=new Map((people||[]).map(p=>[String(p.user_id),p]));const ranksById=new Map((rs||[]).map(r=>[String(r.id),r]));const ranksByName=new Map((rs||[]).map(r=>[String(r.name),r]));return (us||[]).filter(u=>!busy.has(String(u.id))).map(u=>{const person=peopleByUserId.get(String(u.id))||{};const rank=ranksById.get(String(u.rank))||ranksByName.get(String(u.rank));return {...u,profileImage:u.profile_image||"",callSign:text(person.call_sign),serviceNumber:patrolServiceNumber(person),personnelStatus:text(person.personnel_status),department:text(person.department),unit:text(person.unit),rank:rank?.name||u.rank||"Kein Rang",rankShortName:rank?.short_name||rank?.name||u.rank||"Kein Rang"};});
 }
 if(method==="setPatrolTenCode"){
  const au=await authz(env,token,"patrols.view");const d=(args[0]&&typeof args[0]==="object"?args[0]:args[1])||{},pid=text(d.id||d.patrolId||d.patrol_id),code=text(d.tenCode||d.code||d.status);
  if(!pid||!code)throw new Error("Streifen-ID und Ten Code sind erforderlich.");
  const mine=await db(env,"patrol_members",{query:{select:"patrol_id,user_id",patrol_id:`eq.${pid}`}});
  if(!hasEffectivePatrolEdit(au)&&!mine.some(m=>String(m.user_id)===String(au.user.id)))throw Object.assign(new Error("Du darfst den Ten Code dieser Streife nicht ändern."),{status:403});
  await db(env,"patrols",{method:"PATCH",query:{id:`eq.${pid}`},body:{ten_code:code,updated_at:new Date().toISOString()},prefer:"return=minimal"});
  return {success:true,id:pid,tenCode:code};
 }
 if(["createPatrol","updatePatrol"].includes(method)){
  const creating=method==="createPatrol",au=await authz(env,token,creating?"patrols.create":"patrols.view"),d=args[1]||{},pid=creating?id("P"):text(d.id),now=new Date().toISOString();
  if(!pid)throw new Error("Streifen-ID fehlt.");
  const current=creating?[]:await db(env,"patrol_members",{query:{select:"user_id,position",patrol_id:`eq.${pid}`}});
  if(!creating&&!hasEffectivePatrolEdit(au)&&!current.some(m=>String(m.user_id)===String(au.user.id)&&String(m.position).toLowerCase()==="lead"))throw Object.assign(new Error("Du darfst diese Streife nicht bearbeiten."),{status:403});
  const existing=creating?null:(await db(env,"patrols",{query:{select:"id,callsign,number,vehicle_type,ten_code,location,activity,updated_at",id:`eq.${pid}`,limit:"1"}}))?.[0];
  if(!creating&&!existing)throw Object.assign(new Error("Die Streife wurde nicht gefunden."),{status:404});
  if(!creating&&d.updatedAt&&String(d.updatedAt)!==String(existing.updated_at))throw Object.assign(new Error("Die Streife wurde zwischenzeitlich geändert. Bitte öffne sie erneut."),{status:409});
  const members=Array.isArray(d.members)?d.members.slice():current.map(m=>({id:m.user_id,position:m.position}));
  if(creating&&!members.some(m=>text(m.id||m.user_id)===String(au.user.id)))members.unshift({id:au.user.id,position:"Lead"});
  const memberIds=[...new Set(members.map(m=>text(m.id||m.user_id)).filter(Boolean))];
  if(!memberIds.length)throw new Error("Mindestens ein Mitglied muss verbleiben. Beende deinen Dienst über die obere Leiste.");
  if(members.filter(m=>m.position==="Lead").length>1)throw new Error("Eine Streife kann nur einen Streifenführer haben.");
  const [validUsers,people,busy]=await Promise.all([
   db(env,"users",{query:{select:"id,active,approved",id:`in.(${memberIds.join(",")})`,active:"eq.true",approved:"eq.true"}}),
   db(env,"personnel",{query:{select:"user_id,call_sign,service_number",user_id:`in.(${memberIds.join(",")})`}}),
   db(env,"patrol_members",{query:{select:"patrol_id,user_id",user_id:`in.(${memberIds.join(",")})`}})
  ]);
  if(validUsers.length!==memberIds.length)throw new Error("Ein Mitglied ist nicht mehr aktiv oder freigegeben.");
  if(busy.some(m=>String(m.patrol_id)!==pid))throw new Error("Mindestens ein Mitglied ist bereits in einer anderen Streife.");
  const callsign=pickPrimaryPatrolCallsign(people);if(!callsign)throw new Error("Bitte Dienstnummer und Callsign in den Personalakten hinterlegen.");
  const row={callsign,number:parsePatrolCallsign(callsign).number||callsign,vehicle_type:text(d.vehicleType??existing?.vehicle_type),status:"10-1",ten_code:text(d.tenCode||d.status||existing?.ten_code)||"10-1",location:text(d.location??existing?.location),activity:text(d.activity??existing?.activity),updated_at:now,updated_by:au.user.id};
  if(!row.vehicle_type)throw new Error("Fahrzeug fehlt.");
  if(creating)await db(env,"patrols",{method:"POST",body:{id:pid,...row,created_at:now,created_by:au.user.id},prefer:"return=minimal"});
  else await db(env,"patrols",{method:"PATCH",query:{id:`eq.${pid}`},body:row,prefer:"return=minimal"});
  const oldById=new Map(current.map(m=>[String(m.user_id),m]));
  const requestedLead=members.find(m=>m.position==="Lead"),leadId=text(requestedLead?.id||requestedLead?.user_id);
  const desired=memberIds.map(uid=>({patrol_id:pid,user_id:uid,position:uid===leadId?"Lead":"Member"}));
  const additions=desired.filter(m=>!oldById.has(m.user_id));
  if(additions.length)await db(env,"patrol_members",{method:"POST",body:additions,prefer:"return=minimal"});
  for(const old of current){const uid=String(old.user_id),next=desired.find(m=>m.user_id===uid);if(!next)await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`,user_id:`eq.${uid}`},prefer:"return=minimal"});else if(old.position!==next.position)await db(env,"patrol_members",{method:"PATCH",query:{patrol_id:`eq.${pid}`,user_id:`eq.${uid}`},body:{position:next.position},prefer:"return=minimal"});}
  const result=await syncPatrolState(env,pid,au.user.id);
  return {success:true,id:pid,callsign:result.callsign};
 }
 if(method==="joinPatrol"){
  const au=await authz(env,token,"patrols.view"),pid=text(args[1]);
  const [patrol,profile,existing]=await Promise.all([
   db(env,"patrols",{query:{select:"id",id:`eq.${pid}`,limit:"1"}}),
   db(env,"personnel",{query:{select:"user_id,call_sign",user_id:`eq.${au.user.id}`,limit:"1"}}),
   db(env,"patrol_members",{query:{select:"patrol_id,user_id",user_id:`eq.${au.user.id}`,limit:"1"}})
  ]);
  if(!patrol?.length)throw new Error("Diese Streife existiert nicht mehr.");
  if(!text(profile?.[0]?.call_sign))throw new Error("Bitte hinterlege zuerst dein Callsign in deiner Personalakte.");
  if(existing?.length)throw new Error(String(existing[0].patrol_id)===pid?"Du bist bereits dieser Streife zugeordnet.":"Du bist bereits einer anderen Streife zugeordnet. Beende zuerst deinen aktuellen Dienst.");
  const users=await db(env,"users",{query:{select:"id,active,approved",id:`eq.${au.user.id}`,active:"eq.true",approved:"eq.true",limit:"1"}});
  if(!users?.length)throw new Error("Dein Benutzerkonto ist nicht aktiv oder nicht freigegeben.");
  await db(env,"patrol_members",{method:"POST",body:{patrol_id:pid,user_id:au.user.id,position:"Member"},prefer:"return=minimal"});
  const syncResult=await syncPatrolState(env,pid,au.user.id);
  return {success:true,patrolId:pid,callSign:syncResult.callsign||text(profile?.[0]?.call_sign)};
 }
 if(method==="leavePatrol"){
  const au=await authz(env,token),mine=await db(env,"patrol_members",{query:{select:"patrol_id",user_id:`eq.${au.user.id}`,limit:"1"}});
  if(!mine?.length)return {success:true,alreadyOffDuty:true};
  const pid=text(mine[0].patrol_id);
  await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`,user_id:`eq.${au.user.id}`},prefer:"return=minimal"});
  const syncResult=await syncPatrolState(env,pid,au.user.id);
  return {success:true,patrolId:pid,patrolClosed:!syncResult.exists,leadUserId:syncResult.leadUserId||null,callsign:syncResult.callsign||""};
 }
 if(method==="deletePatrol"){await authz(env,token,"patrols.delete");const pid=text(args[1]);await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`},prefer:"return=minimal"});await db(env,"patrols",{method:"DELETE",query:{id:`eq.${pid}`},prefer:"return=minimal"});return {success:true};}
 // records: security is enforced on every operation
 if(method==="getRecordsConfig"){await authz(env,token,"records.view");return {listLimit:50,maxListLimit:100,deleteMasterOnly:true,statuses:[{id:"open",label:"Offen"},{id:"in_progress",label:"In Bearbeitung"},{id:"closed",label:"Abgeschlossen"},{id:"archived",label:"Archiviert"}],types:[{id:"investigation",label:"Ermittlungsakten",permissions:{view:"records.investigations.view",create:"records.investigations.create",edit:"records.investigations.edit"}},{id:"report",label:"Berichte",permissions:{view:"records.reports.view",create:"records.reports.create",edit:"records.reports.edit"}},{id:"ia",label:"IA-Akten",permissions:{view:"records.ia.view",create:"records.ia.create",edit:"records.ia.edit"}},{id:"highcommand",label:"High Command Akten",permissions:{view:"records.highcommand.view",create:"records.highcommand.create",edit:"records.highcommand.edit"}}]};}
 if(method==="getRecords"){
  const au=await authz(env,token,"records.view"),view=canonicalRecordType(args[1]),status=text(args[2]),search=text(args[3]).slice(0,100),limit=Math.min(100,Math.max(1,Math.trunc(Number(args[4]))||50)),offset=Math.min(1000000,Math.max(0,Math.trunc(Number(args[5]))||0));
  let types=visibleRecordTypes(au);
  if(view&&view!=="all"&&view!=="archive")types=types.filter(t=>canonicalRecordType(t)===view);
  if(!types.length)return [];
  const q={select:RECORD_LIST_COLUMNS,type:`in.(${types.join(",")})`,order:"updated_at.desc,id.asc",limit:String(limit),offset:String(offset)};
  if(view==="archive"||status==="archived")q.status="eq.archived";
  else if(["open","in_progress","closed"].includes(status))q.status=`eq.${status}`;
  else q.status="in.(open,in_progress,closed)";
  if(search){const value=search.replace(/[\\"(),.*%_]/g," ").replace(/\s+/g," ").trim();if(value)q.or=`(case_number.ilike.*${value}*,title.ilike.*${value}*,subject.ilike.*${value}*,summary.ilike.*${value}*)`;}
  const rows=await db(env,"fib_records",{query:q});return (rows||[]).map(normalizedRecord);
 }
 if(method==="getRecord"){
  const au=await authz(env,token,"records.view");return normalizedRecord(await recordById(env,au,text(args[1]),"view",RECORD_DETAIL_COLUMNS));
 }
 if(["createRecord","updateRecord","archiveRecord","deleteRecord"].includes(method)){
  const au=await authz(env,token,"records.view"),rid=text(args[1]),d=(method==="createRecord"?args[1]:args[2])||{},now=new Date().toISOString();
  if(method==="createRecord"){
   const type=canonicalRecordType(d.type);if(!recordAllowed(au,type,"create"))throw recordError("Keine Berechtigung für diese Aktenart.",403);
   const row={id:id("R"),case_number:`LSPD-${new Date().getFullYear()}-${Math.floor(10000+Math.random()*90000)}`,type,...recordPatch(d,true),classification:type==="highcommand"?"Streng vertraulich – High Command":type==="ia"?"Geschützt – Internal Affairs":"Intern",created_by:au.user.id,created_by_name:au.user.name,updated_by:au.user.id,updated_by_name:au.user.name,created_at:now,updated_at:now};
   const rows=await db(env,"fib_records",{method:"POST",query:{select:RECORD_DETAIL_COLUMNS},body:row,prefer:"return=representation"});return normalizedRecord(rows?.[0]||row);
  }
  if(method==="deleteRecord"&&!au.master)throw recordError("Nur Master dürfen Akten endgültig löschen.",403);
  const existing=await recordById(env,au,rid,method==="deleteRecord"?"view":"edit");
  if(method==="deleteRecord"){await db(env,"fib_records",{method:"DELETE",query:{id:`eq.${rid}`},prefer:"return=minimal"});return {success:true};}
  if(existing.status==="archived")throw recordError("Archivierte Akten sind schreibgeschützt.",409);
  if(method==="updateRecord"&&d.expectedUpdatedAt&&String(d.expectedUpdatedAt)!==String(existing.updated_at))throw recordError("Die Akte wurde zwischenzeitlich geändert. Bitte sichere deine Eingaben und öffne die Akte erneut.",409);
  const query={id:`eq.${rid}`,type:`eq.${existing.type}`,select:RECORD_DETAIL_COLUMNS};
  if(existing.updated_at)query.updated_at=`eq.${existing.updated_at}`;
  const patch={updated_at:now,updated_by:au.user.id,updated_by_name:au.user.name,...(method==="archiveRecord"?{status:"archived",archived_at:now,archived_by:au.user.id,archived_by_name:au.user.name}:recordPatch(d))};
  const rows=await db(env,"fib_records",{method:"PATCH",query,body:patch,prefer:"return=representation"});if(!rows?.length)throw recordError("Die Akte wurde zwischenzeitlich geändert. Bitte erneut öffnen.",409);return normalizedRecord(rows[0]);
 }
 // Wanted records (Supabase table: wanted)
 if(method==="getWantedConfig"){const au=await authz(env,token,"wanted.view");return {master:au.master,permissions:{view:effectivePermission(au,"wanted.view"),create:effectivePermission(au,"wanted.create"),edit:effectivePermission(au,"wanted.edit"),delete:effectivePermission(au,"wanted.delete")},types:[{id:"person",label:"Person"},{id:"vehicle",label:"Fahrzeug"}],statuses:[{id:"wanted",label:"Gesucht",className:"active"},{id:"observation",label:"Beobachtung",className:"watch"},{id:"captured",label:"Geschlossen",className:"captured"}],dangerLevels:[{id:"low",label:"Niedrig"},{id:"medium",label:"Mittel"},{id:"high",label:"Hoch"},{id:"extreme",label:"Sehr hoch"}]};}
 if(method==="getWanted"||method==="getWantedEntries"){await authz(env,token,"wanted.view");const search=text(args[1]);const q={select:"id,type,name,alias,person_id,plate,vehicle_model,vehicle_color,reason,danger_level,last_seen,wanted_since,captured_at,description,notes,status,created_by_id,created_by,created_at,updated_by,updated_at,armed,expires_on,image_url",order:"created_at.desc",limit:String(Math.min(200,Math.max(1,Number(args[2])||100)))};if(search)q.or=`(name.ilike.*${search}*,plate.ilike.*${search}*,reason.ilike.*${search}*,description.ilike.*${search}*)`;return await db(env,"fib_wanted",{query:q});}
 if(method==="getWantedEntry"){await authz(env,token,"wanted.view");const r=await db(env,"fib_wanted",{query:{select:"id,type,name,alias,person_id,plate,vehicle_model,vehicle_color,reason,danger_level,last_seen,wanted_since,captured_at,description,notes,status,created_by_id,created_by,created_at,updated_by,updated_at,armed,expires_on,image_url",id:`eq.${text(args[1])}`,limit:"1"}});if(!r?.length)throw new Error("Fahndung nicht gefunden.");return r[0];}
 if(method==="createWanted"){const au=await authz(env,token,"wanted.create");const d=args[1]||{};if(!text(d.name))throw new Error("Name ist erforderlich.");const row={...boloFields(d),id:id("W"),created_by_id:au.user.id,created_by:au.user.name,created_at:new Date().toISOString(),status:d.status||"wanted"};const r=await db(env,"fib_wanted",{method:"POST",query:{select:"id,type,name,alias,person_id,plate,vehicle_model,vehicle_color,reason,danger_level,last_seen,wanted_since,captured_at,description,notes,status,created_by_id,created_by,created_at,updated_by,updated_at,armed,expires_on,image_url"},body:row,prefer:"return=representation"});return r?.[0]||row;}
 if(method==="updateWanted"){const au=await authz(env,token,"wanted.edit");const d=args[2]||{};const r=await db(env,"fib_wanted",{method:"PATCH",query:{id:`eq.${text(args[1])}`,select:"id,type,name,alias,person_id,plate,vehicle_model,vehicle_color,reason,danger_level,last_seen,wanted_since,captured_at,description,notes,status,created_by_id,created_by,created_at,updated_by,updated_at,armed,expires_on,image_url"},body:{...boloFields(d),updated_at:new Date().toISOString(),updated_by:au.user.name},prefer:"return=representation"});if(!r?.length)throw recordError("BOLO nicht gefunden.",404);return r[0];}
 if(method==="deleteWanted"){await authz(env,token,"wanted.delete");await db(env,"fib_wanted",{method:"DELETE",query:{id:`eq.${text(args[1])}`},prefer:"return=minimal"});return {success:true};}
 // External record sharing. Tokens are only stored as SHA-256 hashes.
 if(method==="createRecordShare"){
  const au=await authz(env,token,"records.view"),rid=text(args[1]),minutes=Math.min(10080,Math.max(5,Math.trunc(Number(args[2]))||60));
  await recordById(env,au,rid,"edit");
  const raw=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join("");
  const share={id:id("SH"),record_id:rid,token_hash:await sha256(raw),created_by:au.user.id,created_by_name:au.user.name,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+minutes*60000).toISOString(),revoked_at:null};
  await db(env,"fib_record_shares",{method:"POST",body:share,prefer:"return=minimal"});return {success:true,token:raw,expiresAt:share.expires_at,url:`/?recordShare=${raw}`};
 }
 if(method==="getRecordShares"){
  const au=await authz(env,token,"records.view"),rid=text(args[1]);await recordById(env,au,rid,"edit");
  const rows=await db(env,"fib_record_shares",{query:{select:"id,record_id,created_by,created_by_name,created_at,expires_at,revoked_at",record_id:`eq.${rid}`,order:"created_at.desc",limit:"100"}});
  return (rows||[]).map(r=>({...r,active:!r.revoked_at&&Date.parse(r.expires_at)>Date.now()}));
 }
 if(method==="revokeRecordShare"){
  const au=await authz(env,token,"records.view"),sid=text(args[1]);const rows=await db(env,"fib_record_shares",{query:{select:"id,record_id",id:`eq.${sid}`,limit:"1"}});if(!rows?.length)throw recordError("Freigabe nicht verfügbar.",403);
  await recordById(env,au,rows[0].record_id,"edit");await db(env,"fib_record_shares",{method:"PATCH",query:{id:`eq.${sid}`},body:{revoked_at:new Date().toISOString()},prefer:"return=minimal"});return {success:true};
 }
 if(method==="getExternalRecord") {const raw=text(args[0]);if(!raw)throw new Error("Ungültiger Freigabe-Link.");const shares=await db(env,"fib_record_shares",{query:{select:"id,record_id,expires_at,revoked_at",token_hash:`eq.${await sha256(raw)}`,limit:"1"}});const sh=shares?.[0];if(!sh||sh.revoked_at||Date.parse(sh.expires_at)<=Date.now())throw Object.assign(new Error("Diese externe Aktenfreigabe ist ungültig oder abgelaufen."),{status:404});const records=await db(env,"fib_records",{query:{select:"id,case_number,type,title,subject,status,classification,summary,content,created_at,created_by_name,updated_at,updated_by_name",id:`eq.${sh.record_id}`,limit:"1"}});if(!records?.length)throw Object.assign(new Error("Akte nicht gefunden."),{status:404});return records[0];}
 if(method==="getDashboardStatistics"){
  const au=await authz(env,token,"dashboard.view");return dashboardStatistics(env,au,token,args[1]===true);
 }
 // Rank lookup remains in Supabase; legacy sheet modules are handled above.
 if(method==="getRankById"){await authz(env,token);const rows=await db(env,"ranks",{query:{select:"id,name,short_name,level,active",id:`eq.${text(args[1])}`,limit:"1"}});return rows?.[0]||null;}
 // System administration
 if(method==="systemGetUsers"){await authz(env,token,"system.users.view");const [us,rs]=await Promise.all([db(env,"users",{query:{select:"id,username,name,rank,active,approved,master,profile_image",order:"name.asc"}}),rankRows(env)]);return (us||[]).map(u=>({...u,rank_name:(rs||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank)?.name||u.rank||"Kein Rang"}));}
 if(method==="systemGetUserRanks"||method==="systemGetAllRanks"){await authz(env,token,"system.ranks.view");return await rankRows(env);}
 if(method==="systemGetPermissions"){await authz(env,token,"system.permissions.view");return ((await db(env,"permissions",{query:{select:"*",order:"key.asc"}})||[]).filter(isLspdPermission)).map(permission=>({...permission,used:USED_LSPD_PERMISSION_KEYS.has(String(permission.key||""))}));}
 if(method==="systemGetRankPermissions"){
  await authz(env,token,"system.permissions.view");const [links,perms]=await Promise.all([db(env,"rank_permissions",{query:{select:"permission_id",rank_id:`eq.${text(args[1])}`}}),db(env,"permissions",{query:{select:"id,key",limit:"5000"}})]);const visible=new Set((perms||[]).filter(isLspdPermission).map(p=>String(p.id)));return (links||[]).map(x=>x.permission_id).filter(pid=>visible.has(String(pid)));
 }
 if(method==="systemSetRankPermissions"){
  await authz(env,token,"system.permissions.manage");const rid=text(args[1]),selected=new Set((Array.isArray(args[2])?args[2]:[]).map(String));
  const [links,perms]=await Promise.all([db(env,"rank_permissions",{query:{select:"permission_id",rank_id:`eq.${rid}`}}),db(env,"permissions",{query:{select:"id,key",limit:"5000"}})]);const visible=new Set((perms||[]).filter(isLspdPermission).map(p=>String(p.id)));const existing=new Set((links||[]).map(x=>String(x.permission_id)));
  if([...selected].some(pid=>!visible.has(pid)))throw Object.assign(new Error("Ungültige oder nicht freigegebene Berechtigung."),{status:400});
  const remove=[...existing].filter(pid=>visible.has(pid)&&!selected.has(pid));const add=[...selected].filter(pid=>!existing.has(pid));
  if(remove.length)await db(env,"rank_permissions",{method:"DELETE",query:{rank_id:`eq.${rid}`,permission_id:`in.(${remove.join(",")})`},prefer:"return=minimal"});
  if(add.length)await db(env,"rank_permissions",{method:"POST",body:add.map(pid=>({rank_id:rid,permission_id:pid})),prefer:"return=minimal"});clearAuthCaches();return {success:true};
 }
 if(method==="systemCreateRank"){await authz(env,token,"system.ranks.manage");const d=args[1]||{};const row={id:text(d.id)||id("R"),name:text(d.name||d.Name),short_name:text(d.shortName||d.short_name||d.ShortName),level:Number(d.level||d.Level||0),active:d.active!==false&&d.Active!==false};const r=await db(env,"ranks",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;}
 if(method==="systemUpdateRank"){await authz(env,token,"system.ranks.manage");const rid=text(args[1]),d=args[2]||{};const patch={};for(const [k,keys] of Object.entries({name:["name","Name"],short_name:["shortName","short_name","ShortName"],level:["level","Level"],active:["active","Active"]})){const found=keys.find(x=>d[x]!==undefined);if(found)patch[k]=k==="level"?Number(d[found]):k==="active"?(d[found]===true||String(d[found]).toLowerCase()==="true"):text(d[found]);}const r=await db(env,"ranks",{method:"PATCH",query:{id:`eq.${rid}`,select:"*"},body:patch,prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="systemCreatePermission"){
  await authz(env,token,"system.permissions.manage");const d=args[1]||{};const key=text(d.key||d.permission||d.name),name=text(d.name||d.label||key),label=text(d.label||d.name||key);
  if(isFIBClassificationKey(key)||!isLspdPermission({id:d.id,key}))throw Object.assign(new Error("Diese Berechtigung gehört nicht zum LSPD."),{status:403});if(!key)throw new Error("Berechtigungsschlüssel fehlt.");if(!name)throw new Error("Name der Berechtigung fehlt.");
  const row={id:text(d.id)||id("PERM"),key,name,label,description:text(d.description),category:text(d.category)};
  const r=await db(env,"permissions",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;
 }
 if(method==="systemUpdatePermission"){
  await authz(env,token,"system.permissions.manage");const d=args[2]||{};const patch={};for(const k of ["key","name","label","description","category"])if(d[k]!==undefined)patch[k]=text(d[k]);
  const existing=await db(env,"permissions",{query:{select:"id,key",id:`eq.${text(args[1])}`,limit:"1"}});if(!existing?.length||!isLspdPermission(existing[0])||isFIBClassificationKey(patch.key))throw Object.assign(new Error("Diese Berechtigung gehört nicht zum LSPD."),{status:403});
  const r=await db(env,"permissions",{method:"PATCH",query:{id:`eq.${text(args[1])}`,select:"*"},body:patch,prefer:"return=representation"});return r?.[0]||{success:true};
 }
 if(method==="getApiDiagnostics"){
  const au=await authz(env,token,"system.users.view");if(!au.master)throw Object.assign(new Error("Die API-Diagnose ist nur für einen Master verfügbar."),{status:403});
  const specs=[
   ["users","id,username,name,rank,active,approved,master,profile_image"],
   ["ranks","id,name,short_name,level,active"],["permissions","id,key,name,label,description,category"],
   ["rank_permissions","rank_id,permission_id"],["fib_mdt_sessions","token_hash,user_id,expires_at"],
   ["patrols","id,callsign,number,vehicle_type,status,created_at,updated_at"],["patrol_members","patrol_id,user_id,position"],
   ["personnel","user_id,service_number,phone,call_sign,department,unit,email,address,entry_date,personnel_status,note"],
   ["personnel_trainings","id,user_id,name,category,date,instructor,status,expiry_date,notes,created_by,created_at"],
   ["personnel_notes","id,user_id,type,title,content,created_by,created_by_name,created_at"],
   ["personnel_history","id,user_id,action,detail,actor_id,actor_name,created_at"],
   ["personnel_terminations","id,user_id,document_number,public_token_hash,payload,created_by,created_by_name,created_at"],
   ["lspd_service_regulations","id,title,category,content,status,version,updated_at,updated_by,updated_by_name"],
   ["lspd_service_regulation_versions","regulation_id,version,title,category,content,status,updated_at,updated_by,updated_by_name"],
   ["fib_records","id,case_number,type,title,subject,status,classification,summary,content,created_at"],
   ["fib_wanted","id,status"],
   ["fib_record_shares","id,record_id,token_hash,expires_at,revoked_at"],
   ["fib_announcements","id,title,description,status,event_date,metadata,created_at"],
   ["fib_vacations","id,title,description,status,event_date,metadata,created_at"],
   ["fib_equipment_catalog",EQUIPMENT_COLUMNS],
   ["lspd_equipment_special_access","user_id,special_key,enabled,note,updated_by,updated_by_name,updated_at"],
   ["fib_internal_fines","id,title,description,status,event_date,metadata,created_at"],
   ["fib_internal_fine_catalog","id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,updated_at,created_by"],
   ["fib_calendar_events","id,title,description,status,event_date,metadata,created_at"],
   ["fib_gang_profiles","id,title,description,status,event_date,metadata,created_at"],
   ["fib_bonus_entries","id,title,description,status,event_date,metadata,created_at"],
   ["fib_mdt_logs","id,action,module_name,item_id,detail,actor_id,actor_name,created_at"],
   ["department_permissions","id,department,permission_id,created_at,created_by"],
   ["academy_documents","id,title,category,content,active,created_by,created_by_name,created_at,updated_at"],
   ["academy_tests","id,title,description,active,passing_score,questions,created_by,created_by_name,created_at,updated_at"],
   ["academy_attempts","id,test_id,user_id,user_name,score,passed,answers,submitted_at"],
   ["fib_bonus_payouts","id,employee_id,employee_name,rank_id,rank_name,rank_level,event_count,towing_count,drugs_count,entry_control_count,total_amount,status,evidence,description,activity_date,submitted_at"],
   ["fib_org_account","id,balance,updated_at,updated_by"],
   ["fib_accounting_entries","id,entry_type,amount,purpose,description,reference_type,reference_id,created_by,created_by_name,created_at"]
  ];
  const checks=await Promise.all(specs.map(async([table,columns])=>{try{await db(env,table,{query:{select:columns,limit:"0"}});return {table,ok:true};}catch(e){return {table,ok:false,error:String(e?.message||e).slice(0,240)};}}));
  return {success:true,checkedAt:new Date().toISOString(),checks,failed:checks.filter(x=>!x.ok),googleSheets:{configured:Boolean(String(env.GOOGLE_SHEETS_API_URL||"").trim())}};
 }
 if(method==="systemGetDepartmentPermissions"){
  await authz(env,token,"system.permissions.view");
  const departments=["Internal Affairs Division","Central Division","Northern Division","Patrol Division","Investigative Division","Metropolitan Division","Support Division","Internal Affairs","Patrol Unit","Detective Bureau","Special Weapons and Tactics","Gang Enforcement Detail","Canine (K9)","Police Academy","Public Relations Office","Air Support Division","High Command"];
  const perms=await db(env,"permissions",{query:{select:"id,key,name,label,description,category",order:"category.asc,key.asc",limit:"5000"}});
  const links=await db(env,"department_permissions",{query:{select:"department,permission_id",order:"department.asc",limit:"5000"}});
  const visible=(perms||[]).filter(p=>isLspdPermission(p)&&!String(p.key||"").startsWith("system."));const ids=new Set(visible.map(p=>String(p.id)));return {departments,permissions:visible,links:(links||[]).filter(l=>ids.has(String(l.permission_id)))};
 }
 if(method==="systemSetDepartmentPermissions"){
  const au=await authz(env,token,"system.permissions.manage");
  const department=text(args[1]),selected=Array.isArray(args[2])?args[2].map(text).filter(Boolean):[];
  if(!department)throw new Error("Abteilung fehlt.");
  const [perms,links]=await Promise.all([db(env,"permissions",{query:{select:"id,key",limit:"5000"}}),db(env,"department_permissions",{query:{select:"permission_id",department:`eq.${department}`,limit:"5000"}})]);
  const visible=new Set((perms||[]).filter(p=>isLspdPermission(p)&&!String(p.key||"").startsWith("system.")).map(p=>String(p.id)));const chosen=new Set(selected);const existing=new Set((links||[]).map(l=>String(l.permission_id)));
  if([...chosen].some(pid=>!visible.has(pid)))throw Object.assign(new Error("Ungültige oder nicht freigegebene Berechtigung."),{status:400});
  const remove=[...existing].filter(pid=>visible.has(pid)&&!chosen.has(pid)),add=[...chosen].filter(pid=>!existing.has(pid));
  if(remove.length)await db(env,"department_permissions",{method:"DELETE",query:{department:`eq.${department}`,permission_id:`in.(${remove.join(",")})`},prefer:"return=minimal"});
  if(add.length)await db(env,"department_permissions",{method:"POST",body:add.map(permission_id=>({id:id("DP"),department,permission_id,created_at:new Date().toISOString(),created_by:au.user.id})),prefer:"return=minimal"});
  clearAuthCaches();return {success:true};
 }
 if(method==="systemCreateUser"){await authz(env,token,"system.users.manage");const d=args[1]||{};const username=text(d.username||d.Username),name=text(d.name||d.Name),password=String(d.password||d.Password||"");if(!username||!name||!password)throw new Error("Benutzername, Name und Passwort sind erforderlich.");const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");const row={id:id("U"),username,name,rank:text(d.rankId||d.rank)||null,password_salt:salt,password_hash:await sha256(salt+password),active:d.active!==false,approved:d.approved!==false,master:d.master===true,created_at:new Date().toISOString()};const r=await db(env,"users",{method:"POST",query:{select:"id,username,name,rank,active,approved,master"},body:row,prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="systemUpdateUser"){await authz(env,token,"system.users.manage");const uid=text(args[1]),d=args[2]||{},patch={};for(const k of ["name","username","rank","active","approved","master"])if(d[k]!==undefined)patch[k]=d[k];if(d.rankId!==undefined)patch.rank=d.rankId;const r=await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`,select:"id,username,name,rank,active,approved,master"},body:patch,prefer:"return=representation"});clearAuthCaches();return r?.[0]||{success:true};}
 if(method==="systemApproveUser"){await authz(env,token,"system.users.manage");const uid=text(args[1]),rank=text(args[2]);await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`},body:{rank:rank||null,active:true,approved:true},prefer:"return=minimal"});return {success:true};}
 if(method==="systemDeactivateUser"){await authz(env,token,"system.users.manage");await db(env,"users",{method:"PATCH",query:{id:`eq.${text(args[1])}`},body:{active:false},prefer:"return=minimal"});clearAuthCaches();return {success:true};}
 throw Object.assign(new Error(`Serverfunktion „${method}“ ist noch nicht implementiert.`),{status:501,code:"NOT_MIGRATED"});
}

const READ_ONLY_METHODS = new Set([
 "getVehicleCatalog","getDashboardStatistics","getMyPermissions","getAllAgents",
 "getInternalFineCases",
 "getInternalFineCatalog","getInternalFinePersonnel","getInternalSanctionsOverview",
 "getPatrolEligibleUsers","getPatrolTenCodes","getPatrolDutyConfig","getPatrols",
 "getPersonnelFile","getPersonnelFileBundle","getPersonnelHistory","getPersonnelList","getPersonnelNotes","getPersonnelTerminations",
 "getPersonnelRankOptions","getPersonnelTrainings","getRankById","getRecord",
 "getRecordShares","getRecords","getRecordsConfig","getWanted","getWantedConfig",
 "getWantedEntries","getWantedEntry","getWarrantStatistics","getWarrants",
 "systemGetAllRanks","systemGetPermissions","systemGetRankPermissions","systemGetUserRanks",
 "systemGetUsers","getApiDiagnostics","getExternalRecord"
]);
function auditModule(method,args){
 const first=String(args?.[0]??"");
 if(["announcements","vacations","ifines","calendar","gangs","bonuses","logs"].includes(first) &&
    /ModuleItem/.test(method)) return first;
 if(/Regulation/i.test(method)) return "regulations";
 if(/Equipment/i.test(method)) return "armory";
 if(/Patrol/i.test(method)) return "patrols";
 if(/Personnel|Agent/i.test(method)) return "personnel";
 if(/Record|Share/i.test(method)) return "records";
 if(/Wanted/i.test(method)) return "wanted";
 if(/Warrant/i.test(method)) return "warrants";
 if(/InternalFine|Sanction/i.test(method)) return "ifines";
 if(/Vehicle/i.test(method)) return "vehicle_catalog";
 if(/Academy/i.test(method)) return "academy";
 if(/^system/i.test(method)) return "system";
 if(/Fine/i.test(method)) return "fines";
 if(/Lawyer/i.test(method)) return "lawyers";
 if(/Sheet|Attorney/i.test(method)) return "sheets";
 return "mdt";
}
function auditAction(method){
 if(/^(create|add|systemCreate)/i.test(method)) return "create";
 if(/^(update|save|systemUpdate|set)/i.test(method)) return "update";
 if(/^(delete|remove|systemDeactivate)/i.test(method)) return "delete";
 if(/^approve/i.test(method)) return "approve";
 if(/^reject/i.test(method)) return "reject";
 if(/^archive/i.test(method)) return "archive";
 if(/^revoke/i.test(method)) return "revoke";
 if(/^join/i.test(method)) return "join";
 if(/^leave/i.test(method)) return "leave";
 if(/^refresh/i.test(method)) return "refresh";
 return "execute";
}
async function dispatch(method,args,env,token){
 const result = await dispatchCore(method,args,env,token);
 if(/^(createRecord|updateRecord|archiveRecord|deleteRecord|createWanted|updateWanted|deleteWanted|startDuty|leavePatrol|joinPatrol|createPatrol|deletePatrol|system(?:Create|Update|Set|Approve|Deactivate).*|savePersonnelDepartment|refreshWarrantsCache)$/.test(method)||(/ModuleItem$/.test(method)&&method!=="getModuleItems"&&args[1]==="announcements")){dashboardStatsEpoch++;dashboardStatsCache.clear();dashboardQueryCache.clear();}
 if(method!=="markNotificationsRead" && method!=="setEquipmentSpecialAccess" && !READ_ONLY_METHODS.has(method) && !/^(get|list|search|check|has|validate|preview|load)/i.test(method)){
  try{
   const actor = await authz(env,token);
   const moduleName = auditModule(method,args);
   const action = auditAction(method);
   const itemId = [
    result?.id, result?.item?.id, args?.[1]?.id,
    typeof args?.[1] === "string" ? args[1] : null,
    args?.[0]?.id, typeof args?.[0] === "string" ? args[0] : null
   ].find(value => value !== undefined && value !== null && value !== "") || null;
   const detailParts = [method];
   const label = result?.title || args?.[0]?.title || args?.[2]?.title || args?.[0]?.name || args?.[1]?.name;
   if(label) detailParts.push(String(label).slice(0,180));
   await writeAudit(env,actor,action,moduleName,itemId,detailParts.join(" · "));
  }catch(error){
   console.warn("Central audit logging skipped:",error?.message||error);
  }
 }
 return result;
}

export async function onRequest({request,env}){
 if(request.method==="OPTIONS")return new Response(null,{status:204});
 const url=new URL(request.url);try{
  if(url.pathname.startsWith("/api/auth/")){if(request.method!=="POST")return bad("Methode nicht erlaubt.",405);const p=await readJson(request);const result=await handleAuth(url.pathname.slice("/api/auth/".length),request,env,p);if(result)return result;}
  // Permanent public termination document. No MDT session is required; the token is verified by SHA-256 hash.
  if(url.pathname==="/api/public/termination") {
   if(request.method!=="GET") return bad("Methode nicht erlaubt.",405);
   const raw=text(url.searchParams.get("token"));
   if(!raw) return bad("Ungültiger Dokument-Link.",400);
   const rows=await db(env,"personnel_terminations",{query:{select:"id,user_id,document_number,payload,created_by_name,created_at",public_token_hash:`eq.${await sha256(raw)}`,limit:"1"}});
   const row=rows?.[0]; if(!row) throw Object.assign(new Error("Dieses Dokument wurde nicht gefunden."),{status:404});
   return json({success:true,document:{...row.payload,id:row.id,documentNumber:row.document_number,createdBy:row.created_by_name,createdAt:row.created_at}});
  }
  // Public, time-limited record share. No MDT session is required; the token
  // is verified by its SHA-256 hash and the record is returned in UI field names.
  if(url.pathname==="/api/public/record-share") {
   if(request.method!=="GET") return bad("Methode nicht erlaubt.",405);
   const raw=text(url.searchParams.get("token"));
   if(!raw) return bad("Ungültiger Freigabe-Link.",400);
   const shares=await db(env,"fib_record_shares",{
    query:{select:"id,record_id,created_at,expires_at,revoked_at",token_hash:`eq.${await sha256(raw)}`,limit:"1"}
   });
   const share=shares?.[0];
   if(!share||share.revoked_at||Date.parse(share.expires_at)<=Date.now())
    throw Object.assign(new Error("Diese externe Aktenfreigabe ist ungültig oder abgelaufen."),{status:404});
   const records=await db(env,"fib_records",{
    query:{select:"id,case_number,type,title,subject,status,classification,summary,content,created_at,created_by_name,updated_at,updated_by_name",id:`eq.${share.record_id}`,limit:"1"}
   });
   const record=records?.[0];
   if(!record) throw Object.assign(new Error("Akte nicht gefunden."),{status:404});
   const typeLabels={investigation:"Ermittlungsakte",report:"Bericht",ia:"IA-Akte",highcommand:"High Command Akte"};
   const statusLabels={open:"Offen",in_progress:"In Bearbeitung",closed:"Abgeschlossen",archived:"Archiviert"};
   return json({
    success:true,
    record:{
     id:record.id,
     caseNumber:record.case_number,
     type:record.type,
     typeLabel:typeLabels[record.type]||record.type||"Vorgang",
     title:record.title,
     subject:record.subject,
     status:record.status,
     statusLabel:statusLabels[String(record.status||"").toLowerCase()]||record.status,
     classification:record.classification,
     summary:record.summary,
     content:record.content,
     createdAt:record.created_at,
     createdBy:record.created_by_name,
     updatedAt:record.updated_at,
     updatedBy:record.updated_by_name,
     shareCreatedAt:share.created_at,
     shareExpiresAt:share.expires_at
    }
   });
  }
  if(url.pathname==="/api/academy-upload") {
   if(request.method!=="POST") return bad("Methode nicht erlaubt.",405);
   const au=await authz(env,bearer(request,{}),"academy.manage");
   const uploadRanks=await rankRows(env); const uploadRank=uploadRanks.find(r=>String(r.id)===String(au.user.rank))||uploadRanks.find(r=>String(r.name)===String(au.user.rank)); if(!au.master&&Number(uploadRank?.level||0)<2)return bad("Die Verwaltung der Academy ist erst ab Rang-Level 2 freigeschaltet.",403);
   const form=await request.formData(); const file=form.get("file"); const title=text(form.get("title")); const category=text(form.get("category"))||"Ausbildung";
   if(!(file instanceof File)) return bad("Keine PDF-Datei übertragen.");
   if(!title) return bad("Titel ist erforderlich.");
   if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name)) return bad("Es sind ausschließlich PDF-Dateien erlaubt.");
   if(file.size>10*1024*1024) return bad("Die PDF darf maximal 10 MB groß sein.");
   const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_"); const path=`${au.user.id}/${crypto.randomUUID()}-${safeName}`; const {url,key}=config(env);
   const upload=await fetch(`${url}/storage/v1/object/academy-documents/${path}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/pdf","x-upsert":"false"},body:await file.arrayBuffer()});
   if(!upload.ok){const msg=await upload.text();throw Object.assign(new Error(`PDF konnte nicht gespeichert werden: ${msg.slice(0,240)}`),{status:upload.status});}
   const row={id:id("ACD"),title,category,description:`Importierte PDF: ${file.name}`,content:"",file_name:file.name,file_path:path,mime_type:"application/pdf",file_size:file.size,active:true,created_by:au.user.id,created_by_name:au.user.name,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   try{await db(env,"academy_documents",{method:"POST",body:row,prefer:"return=minimal"});}catch(error){await fetch(`${url}/storage/v1/object/academy-documents/${path}`,{method:"DELETE",headers:{apikey:key,Authorization:`Bearer ${key}`}}).catch(()=>{});throw error;}
   return json({success:true,document:{id:row.id,title:row.title,fileName:row.file_name}});
  }
  if(url.pathname==="/api/academy"){if(request.method!=="POST")return bad("Methode nicht erlaubt.",405);const p=await readJson(request);const method=text(p.method);const callArgs=Array.isArray(p.args)?p.args:[];const result=await dispatch(method,callArgs,env,bearer(request,p));return json(result);}
  if(url.pathname.startsWith("/api/legacy/")){if(request.method!=="POST")return bad("Methode nicht erlaubt.",405);const p=await readJson(request);const method=decodeURIComponent(url.pathname.slice("/api/legacy/".length));const callArgs=Array.isArray(p.args)?p.args:[];const result=await dispatch(method,callArgs,env,bearer(request,p));return json(result);}
  if(url.pathname==="/api/health") {
   // Real connectivity check; never return credentials or the Supabase project URL.
   config(env);
   const deep=url.searchParams.get("deep")==="1";
   const required=deep
    ? ["users","ranks","permissions","rank_permissions","fib_mdt_sessions","fib_records","patrols","fib_wanted","patrol_members","personnel","personnel_notes","personnel_trainings","fib_record_shares","fib_announcements","fib_vacations","fib_internal_fines","fib_internal_fine_catalog","fib_vehicle_catalog","fib_calendar_events","fib_gang_profiles","fib_bonus_entries","fib_mdt_logs","department_permissions","academy_documents","academy_tests","academy_attempts","fib_uniform_catalog","fib_uniform_organization_rules","fib_bonus_payouts","fib_org_account","fib_accounting_entries","patrol_ten_code_settings","patrol_duty_settings","fib_dispatch_briefings","lspd_service_regulations","lspd_service_regulation_versions"]
    : ["users","fib_mdt_sessions"];
   const checks=await Promise.all(required.map(async table=>{
    try { await db(env,table,{query:{select:"*",limit:"0"}}); return {table,ok:true}; }
    catch(error) { console.error(`[LSPD MDT health] ${table}:`,error?.message||error); return {table,ok:false}; }
   }));
   const failed=checks.filter(x=>!x.ok).map(x=>x.table);
   const sheetsConfigured=Boolean(String(env.GOOGLE_SHEETS_API_URL||"").trim());
   const missingConfig=deep&&!sheetsConfigured?["GOOGLE_SHEETS_API_URL"]:[];
   const ok=failed.length===0&&missingConfig.length===0;
   return json({ok,service:"LSPD MDT API",supabase:{configured:true,connected:checks.some(x=>x.ok),tables:deep?checks:undefined,failedTables:failed.length?failed:undefined},googleSheets:{configured:sheetsConfigured,requiredFor:["Bußgeldkatalog","Anwaltskammer","Haftbefehle"]},missingConfig:missingConfig.length?missingConfig:undefined,timestamp:new Date().toISOString()},ok?200:503);
  }
  return bad("API-Endpunkt nicht gefunden.",404);
 }catch(e){console.error("LSPD MDT API:",e);return bad(e?.message||"Interner Serverfehler.",e?.status||500,e?.code);}
}
