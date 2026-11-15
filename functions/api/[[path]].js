import { config, db, json, readJson } from "../_lib/supabase.js";
import { SHEET_BACKED_METHODS, googleSheetsCall } from "../_lib/google-sheets.js";
import { bearer, createSession, getPermissions, publicUser, requireSession, sha256, verifyPassword } from "../_lib/auth.js";
const bad=(message,status=400,code)=>json({success:false,message,...(code?{code}:{})},status);
const text=v=>String(v??"").trim();
const id=prefix=>prefix+crypto.randomUUID().replace(/-/g,"").slice(0,14).toUpperCase();
async function authz(env,token,permission){const auth=await requireSession(env,token);if(!auth)throw Object.assign(new Error("Deine Sitzung ist abgelaufen. Bitte erneut anmelden."),{status:401});const p=await getPermissions(env,auth.user);if(auth.user.master!==true&&permission&&!p.permissions.includes("*")&&!p.permissions.includes(permission))throw Object.assign(new Error("Du besitzt nicht die erforderliche Berechtigung."),{status:403});return {...auth,master:auth.user.master===true,permissions:p.permissions};}
async function has(env,auth,perm){return auth.master||auth.permissions.includes("*")||auth.permissions.includes(perm)}
async function rankRows(env){return await db(env,"ranks",{query:{select:"id,name,short_name,level,active",order:"level.desc"}})}
async function permissionsFor(env,auth){return {master:auth.master,permissions:auth.permissions}}
async function handleAuth(path,request,env,payload){const args=Array.isArray(payload.args)?payload.args:[];const token=bearer(request,payload);
 if(path==="login"){const username=text(args[0]),password=String(args[1]??"");if(!username||!password)return bad("Benutzername und Passwort erforderlich.");const rows=await db(env,"users",{query:{select:"id,username,name,rank,password_salt,password_hash,active,approved,master,profile_image",username:`ilike.${username.replace(/[%,_*]/g," ")}`,limit:"1"}});const u=Array.isArray(rows)?rows[0]:null;if(!u||!(await verifyPassword(password,u.password_salt,u.password_hash)))return bad("Benutzername oder Passwort ist falsch.",401,"INVALID_CREDENTIALS");if(u.approved!==true)return bad("Dieser Account wartet noch auf die Freigabe durch einen Master.",403,"ACCOUNT_PENDING");if(u.active!==true)return bad("Dieser Benutzer ist deaktiviert.",403,"ACCOUNT_DISABLED");const sess=await createSession(env,u.id);return json({success:true,token:sess.token,expiresAt:sess.expiresAt,user:publicUser(u)});}
 if(path==="register"){const username=text(args[0]),name=text(args[1]),password=String(args[2]??"");if(!username||!name||!password)return bad("Benutzername, Name und Passwort sind erforderlich.");if(password.length<8)return bad("Das Passwort muss mindestens 8 Zeichen lang sein.");const existing=await db(env,"users",{query:{select:"id",username:`ilike.${username.replace(/[%,_*]/g," ")}`,limit:"1"}});if(existing?.length)return bad("Dieser Benutzername existiert bereits.",409);const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");await db(env,"users",{method:"POST",body:{id:id("U"),username,name,rank:null,password_salt:salt,password_hash:await sha256(salt+password),active:false,approved:false,master:false,profile_image:null,created_at:new Date().toISOString()},prefer:"return=minimal"});return json({success:true,message:"Der Account wurde beantragt und muss durch einen Master freigegeben werden."});}
 if(path==="session"){const a=await requireSession(env,args[0]||token);return a?json(publicUser(a.user)):bad("Deine Sitzung ist abgelaufen. Bitte erneut anmelden.",401);}
 if(path==="session-info"){const a=await requireSession(env,args[0]||token);return a?json({success:true,user:publicUser(a.user),expiresAt:a.session.expires_at}):bad("Sitzung abgelaufen.",401);}
 if(path==="permissions"){const a=await authz(env,args[0]||token);return json(await permissionsFor(env,a));}
 if(path==="logout"){const t=String(args[0]||token||"");if(t)await db(env,"fib_mdt_sessions",{method:"DELETE",query:{token_hash:`eq.${await sha256(t)}`},prefer:"return=minimal"});return json({success:true});}
 if(path==="password"){const t=String(args[0]||token),current=String(args[1]??""),next=String(args[2]??"");const a=await authz(env,t);if(!current||!next)return bad("Aktuelles und neues Passwort sind erforderlich.");if(next.length<8)return bad("Das neue Passwort muss mindestens 8 Zeichen lang sein.");const rows=await db(env,"users",{query:{select:"password_salt,password_hash",id:`eq.${a.user.id}`,limit:"1"}});const u=rows?.[0];if(!u||!(await verifyPassword(current,u.password_salt,u.password_hash)))return bad("Das aktuelle Passwort ist falsch.",403);const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");await db(env,"users",{method:"PATCH",query:{id:`eq.${a.user.id}`},body:{password_salt:salt,password_hash:await sha256(salt+next),updated_at:new Date().toISOString()},prefer:"return=minimal"});return json({success:true,message:"Passwort geändert."});}
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
  return json({success:true,profileImage:publicUrl});
 }
 if(path==="profile-image/remove") {
  const a=await authz(env,args[0]||token); const old=String(a.user.profile_image||"");
  if(old){const match=old.match(/\/fib-profile-images\/([^?]+)/);if(match){const {url,key}=config(env);await fetch(`${url}/storage/v1/object/fib-profile-images/${match[1]}`,{method:"DELETE",headers:{apikey:key,Authorization:`Bearer ${key}`}}).catch(()=>{});}}
  await db(env,"users",{method:"PATCH",query:{id:`eq.${a.user.id}`},body:{profile_image:null,updated_at:new Date().toISOString()},prefer:"return=minimal"});
  return json({success:true,profileImage:""});
 }
 return null;
}
const MODULES = {
 announcements:{table:"fib_announcements",view:"announcements.view",manage:"announcements.manage",label:"Bekanntmachungen"},
 vacations:{table:"fib_vacations",view:"vacations.view",manage:"vacations.manage",label:"Urlaubsverwaltung"},
 ifines:{table:"fib_internal_fines",view:"ifines.view",manage:"ifines.manage",label:"Interne Bußgelder"},
 calendar:{table:"fib_calendar_events",view:"calendar.view",manage:"calendar.manage",label:"Kalender"},
 gangs:{table:"fib_gang_profiles",view:"gangs.view",manage:"gangs.manage",label:"Gangübersicht"},
 bonuses:{table:"fib_bonus_entries",view:"bonuses.view",manage:"bonuses.manage",label:"Bonussystem"},
 logs:{table:"fib_mdt_logs",view:"logs.view",manage:null,label:"Systemprotokolle"}
};
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
async function moduleDispatch(method,args,env,token){
 const actions={getModuleItems:"list",createModuleItem:"create",updateModuleItem:"update",deleteModuleItem:"delete"};
 const action=actions[method]; if(!action)return undefined;
 const moduleKey=text(action==="list"?args[1]:args[action==="create"?1:1]).toLowerCase();
 const cfg=MODULES[moduleKey]; if(!cfg)throw Object.assign(new Error("Unbekanntes MDT-Modul."),{status:400});
 const auth=await authz(env,token,cfg.view);
 if(action==="list"){
  const query={select:"*",order:"created_at.desc",limit:moduleKey==="logs"?"300":"200"};
  if(moduleKey==="logs"&&!auth.master&&!auth.permissions.includes("*"))await authz(env,token,"logs.view");
  const rows=await db(env,cfg.table,{query});return (rows||[]).map(normalizeModuleRow);
 }
 if(!cfg.manage)throw Object.assign(new Error("Dieses Modul ist schreibgeschützt."),{status:403});
 if(!await has(env,auth,cfg.manage))throw Object.assign(new Error("Du besitzt keine Änderungsberechtigung für dieses Modul."),{status:403});
 if(action==="create"){
  const d=args[2]||{}; const title=text(d.title); if(!title)throw new Error("Ein Titel ist erforderlich.");
  const row={id:id(moduleKey.slice(0,3).toUpperCase()),title,description:text(d.description),status:text(d.status)||"active",event_date:d.eventDate||d.event_date||null,metadata:d.metadata&&typeof d.metadata==="object"?d.metadata:{},created_by:auth.user.id,created_by_name:auth.user.name,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const saved=await db(env,cfg.table,{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"}); await writeAudit(env,auth,"create",moduleKey,row.id,title);return normalizeModuleRow(saved?.[0]||row);
 }
 const itemId=text(args[2]); if(!itemId)throw new Error("Ein Eintrag muss ausgewählt werden.");
 if(action==="delete") {await db(env,cfg.table,{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});await writeAudit(env,auth,"delete",moduleKey,itemId);return {success:true};}
 const d=args[3]||{}; const patch={updated_at:new Date().toISOString()};
 for(const k of ["title","description","status"])if(d[k]!==undefined)patch[k]=text(d[k]);
 if(d.eventDate!==undefined||d.event_date!==undefined)patch.event_date=d.eventDate||d.event_date||null;
 if(d.metadata!==undefined)patch.metadata=d.metadata&&typeof d.metadata==="object"?d.metadata:{};
 const saved=await db(env,cfg.table,{method:"PATCH",query:{id:`eq.${itemId}`,select:"*"},body:patch,prefer:"return=representation"});await writeAudit(env,auth,"update",moduleKey,itemId,patch.title||"");return normalizeModuleRow(saved?.[0]||{id:itemId,...patch});
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
  return {canManage:au.master===true,items:(rows||[]).map(r=>({...r,item_type:r.item_type==="fine"?"sanction":r.item_type,sanction_type:r.sanction_type||(r.item_type==="fine"?"fine":null)}))};
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
  return (users||[]).map(u=>{const p=(people||[]).find(x=>String(x.user_id)===String(u.id))||{};const r=(ranks||[]).find(x=>String(x.id)===String(u.rank)||x.name===u.rank);return {id:u.id,name:u.name,rank:r?.name||u.rank||"Kein Rang",serviceNumber:p.service_number||"",callSign:p.call_sign||"",department:p.department||"",unit:p.unit||"",personnelStatus:p.personnel_status||""};});
 }
 if(method==="getInternalFineCases"){
  await view();
  const rows=await db(env,"fib_internal_fines",{query:{select:"*",order:"created_at.desc",limit:"300"}});
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
  if(text(d.id)) saved=await db(env,"fib_internal_fine_catalog",{method:"PATCH",query:{id:`eq.${text(d.id)}`,select:"*"},body:row,prefer:"return=representation"});
  else {row.id=id("IFC");row.created_at=new Date().toISOString();row.created_by=au.user.id;saved=await db(env,"fib_internal_fine_catalog",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});}
  await writeAudit(env,au,text(d.id)?"update":"create","internal_fine_catalog",saved?.[0]?.id||row.id,title);return saved?.[0]||row;
 }
 if(method==="deleteInternalFineCatalogItem"){
  const au=await authz(env,token),itemId=text(args[1]);if(!au.master)throw Object.assign(new Error("Nur Master-Benutzer dürfen den Sanktionskatalog verwalten."),{status:403});if(!itemId)throw new Error("Eintrag fehlt.");
  const found=await db(env,"fib_internal_fine_catalog",{query:{select:"id,item_type",id:`eq.${itemId}`,limit:"1"}});if(!found?.length)throw Object.assign(new Error("Katalogeintrag nicht gefunden."),{status:404});
  if(found[0].item_type==="category") {const linked=await db(env,"fib_internal_fine_catalog",{query:{select:"id",category_id:`eq.${itemId}`,limit:"1"}});if(linked?.length)throw new Error("Die Kategorie enthält noch Sanktionen. Bitte zuerst diese verschieben oder entfernen.");}
  await db(env,"fib_internal_fine_catalog",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});await writeAudit(env,au,"delete","internal_fine_catalog",itemId);return {success:true};
 }
 if(method==="createInternalFineCase"){
  const au=await authz(env,token,"ifines.manage"),d=args[1]||{},personId=text(d.personnelId),fineId=text(d.fineId||d.sanctionId);if(!personId||!fineId)throw new Error("Bitte Beamten und Sanktion auswählen.");
  const [catalog,users,people,ranks]=await Promise.all([
   db(env,"fib_internal_fine_catalog",{query:{select:"*",id:`eq.${fineId}`,item_type:"in.(sanction,fine)",active:"eq.true",limit:"1"}}),
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
  const saved=await db(env,"fib_internal_fines",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});await writeAudit(env,au,"create","internal_fine_case",idValue,row.title);return normalizeModuleRow(saved?.[0]||row);
 }
}

async function dispatch(method,args,env,token){
 // These legacy reference modules remain live in their original Google Sheets.
 if(SHEET_BACKED_METHODS.has(method)){
  if(method==="getWarrants"||method==="getWarrantStatistics") await authz(env,token,"warrants.view");
  else if(method==="refreshWarrantsCache") await authz(env,token,"warrants.manage");
  else await authz(env,token);
  return await googleSheetsCall(env,method,args);
 }
 // Vehicle catalog: master-managed reference list for the Bureau.
 if(method==="getVehicleCatalog"){
  const au=await authz(env,token,"patrols.view");
  const query={select:"id,name,vehicle_class,image_url,description,active,created_at,updated_at",order:"vehicle_class.asc,name.asc",limit:"500"};
  if(!au.master)query.active="eq.true";
  const items=await db(env,"fib_vehicle_catalog",{query});
  return {items:items||[],canManage:au.master===true};
 }
 if(method==="saveVehicleCatalogItem"){
  const au=await authz(env,token,"patrols.view");
  if(!au.master)throw Object.assign(new Error("Die Fahrzeugverwaltung ist ausschließlich Master-Benutzern vorbehalten."),{status:403});
  const d=args[0]||{},name=text(d.name),vehicleClass=text(d.vehicleClass||d.vehicle_class),imageUrl=text(d.imageUrl||d.image_url);
  const allowed=["STR","STR (UM)","OFF","OFF (UM)","HSP","HSP (UM)","OVW"];
  if(!name)throw new Error("Bitte einen Fahrzeugnamen angeben.");
  if(!allowed.includes(vehicleClass))throw new Error("Bitte eine gültige Fahrzeugklasse auswählen.");
  if(imageUrl&&!/^https:\/\//i.test(imageUrl))throw new Error("Der Bildlink muss eine HTTPS-Adresse sein.");
  const row={name,vehicle_class:vehicleClass,image_url:imageUrl||null,description:text(d.description)||null,active:d.active!==false,updated_at:new Date().toISOString()};
  const itemId=text(d.id);
  const saved=itemId
   ? (await db(env,"fib_vehicle_catalog",{method:"PATCH",query:{id:`eq.${itemId}`,select:"*",},body:row,prefer:"return=representation"}))?.[0]
   : (await db(env,"fib_vehicle_catalog",{method:"POST",query:{select:"*"},body:{...row,id:id("VEH"),created_at:new Date().toISOString()},prefer:"return=representation"}))?.[0];
  return {success:true,item:saved||row};
 }
 if(method==="deleteVehicleCatalogItem"){
  const au=await authz(env,token,"patrols.view");
  if(!au.master)throw Object.assign(new Error("Die Fahrzeugverwaltung ist ausschließlich Master-Benutzern vorbehalten."),{status:403});
  const itemId=text(args[0]);if(!itemId)throw new Error("Fahrzeug-ID fehlt.");
  await db(env,"fib_vehicle_catalog",{method:"DELETE",query:{id:`eq.${itemId}`},prefer:"return=minimal"});
  return {success:true};
 }
 // Auth / profile
 const noarg=args; const a=()=>authz(env,token);
 const internalFineResult=await internalFineDispatch(method,args,env,token); if(internalFineResult!==undefined)return internalFineResult;
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
  return (users||[]).map(u=>{
   const p=normalizePersonnelRow((people||[]).find(x=>String(x.user_id)===String(u.id))||{});
   const r=(ranks||[]).find(x=>String(x.id)===String(u.rank)||String(x.name)===String(u.rank));
   return {...p,id:u.id,userId:u.id,username:u.username,name:u.name,rank:r?.name||u.rank||"Kein Rang",rankId:r?.id||u.rank||"",rankLevel:r?.level||0,active:u.active,approved:u.approved,profileImage:u.profile_image||p.profileImage||""};
  });
 }
 if(method==="getPersonnelRankOptions"){await authz(env,token,"officers.view");return await rankRows(env);}
 if(method==="getPersonnelFileBundle"||method==="getPersonnelFile"){
  const au=await authz(env,token,"officers.view");const uid=text(args[1]);if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const us=await db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",id:`eq.${uid}`,limit:"1"}});if(!us?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  const [pp,tt,nn,ss,ranks]=await Promise.all([
   db(env,"personnel",{query:{select:"*",user_id:`eq.${uid}`,limit:"1"}}),
   db(env,"personnel_trainings",{query:{select:"*",user_id:`eq.${uid}`,order:"created_at.desc"}}),
   db(env,"personnel_notes",{query:{select:"*",user_id:`eq.${uid}`,order:"created_at.desc"}}),
   db(env,"fib_internal_fines",{query:{select:"id,title,description,status,event_date,metadata,created_at", "metadata->>personnel_id":`eq.${uid}`,"metadata->>record_type":"eq.internal_fine_case",order:"created_at.desc",limit:"300"}}),
   rankRows(env)
  ]);
  const u=us[0],p=normalizePersonnelRow(pp?.[0]||{}),rank=(ranks||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank);
  const viewerRank=(ranks||[]).find(r=>String(r.id)===String(au.user.rank)||r.name===au.user.rank);
  const canViewSanctions=au.master===true||!!(viewerRank&&rank&&Number(rank.level)<Number(viewerRank.level));
  const agent={...u,...p,rank:rank?.name||u.rank||"Kein Rang",rankId:rank?.id||u.rank||"",rankName:rank?.name||u.rank||"Kein Rang",profileImage:u.profile_image||p.profileImage||""};
  const sanctions=canViewSanctions?(ss||[]).filter(r=>r.metadata?.record_type==="internal_fine_case").map(normalizeModuleRow):[];
  return {agent,personnel:p,trainings:(tt||[]).map(normalizeTrainingRow),notes:(nn||[]).map(normalizePersonnelNoteRow),sanctions,sanctionsVisible:canViewSanctions,rankOptions:ranks||[]};
 }
 if(method==="savePersonnelProfile"){
  const au=await authz(env,token,"officers.edit");const uid=text(args[1]),data=args[2]||{};if(!uid)throw new Error("Keine Benutzer-ID angegeben.");
  const target=await db(env,"users",{query:{select:"id",id:`eq.${uid}`,limit:"1"}});if(!target?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});
  const rankId=text(data.rankId);if(rankId)await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`},body:{rank:rankId},prefer:"return=minimal"});
  const payload={user_id:uid,service_number:text(data.serviceNumber),phone:text(data.phone),call_sign:text(data.callSign),department:text(data.department),unit:text(data.unit),email:text(data.email),address:text(data.address),entry_date:data.entryDate||null,personnel_status:text(data.personnelStatus),note:text(data.note)};
  const existing=await db(env,"personnel",{query:{select:"user_id",user_id:`eq.${uid}`,limit:"1"}});
  if(existing?.length)await db(env,"personnel",{method:"PATCH",query:{user_id:`eq.${uid}`},body:payload,prefer:"return=minimal"});else await db(env,"personnel",{method:"POST",body:payload,prefer:"return=minimal"});
  return {success:true,personnel:normalizePersonnelRow(payload)};
 }
 if(method==="getPersonnelTrainings"||method==="getPersonnelNotes"){
  await authz(env,token,"officers.view");const uid=text(args[1]);if(!uid)throw new Error("Keine Benutzer-ID angegeben.");const training=method==="getPersonnelTrainings",table=training?"personnel_trainings":"personnel_notes";const rows=await db(env,table,{query:{select:"*",user_id:`eq.${uid}`,order:"created_at.desc"}});return (rows||[]).map(training?normalizeTrainingRow:normalizePersonnelNoteRow);
 }
 if(method==="createPersonnelTraining"||method==="createPersonnelNote") {
  const au=await authz(env,token,"officers.edit");const uid=text(args[1]),d=args[2]||{};if(!uid)throw new Error("Keine Benutzer-ID angegeben.");const user=await db(env,"users",{query:{select:"id",id:`eq.${uid}`,limit:"1"}});if(!user?.length)throw Object.assign(new Error("Beamter nicht gefunden."),{status:404});const now=new Date().toISOString();
  const training=method==="createPersonnelTraining";
  const row=training?{
   id:id("TR"),user_id:uid,name:text(d.name),category:text(d.category),date:d.date||null,instructor:text(d.instructor),status:text(d.status)||"Bestanden",expiry_date:d.expiryDate||d.expiry_date||null,notes:text(d.notes),created_by:au.user.id,created_by_name:au.user.name,created_at:now
  }:{id:id("NT"),user_id:uid,type:text(d.type)||"Vermerk",title:text(d.title),content:text(d.content),created_by:au.user.id,created_by_name:au.user.name,created_at:now};
  if(training&&!row.name)throw new Error("Bitte eine Bezeichnung für die Schulung angeben.");if(!training&&!row.title)throw new Error("Bitte einen Titel für den Vermerk angeben.");
  const rows=await db(env,training?"personnel_trainings":"personnel_notes",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});const saved=rows?.[0]||row;return training?normalizeTrainingRow(saved):normalizePersonnelNoteRow(saved);
 }
 if(method==="deletePersonnelTraining"||method==="deletePersonnelNote"){await authz(env,token,"officers.edit");const table=method==="deletePersonnelTraining"?"personnel_trainings":"personnel_notes";await db(env,table,{method:"DELETE",query:{id:`eq.${text(args[2])}`,user_id:`eq.${text(args[1])}`},prefer:"return=minimal"});return {success:true};}
 // Master-only patrol roster display colors. Settings are persisted in Supabase.
 const PATROL_COLOR_DEFAULTS={callsignTypeBg:"#174a70",callsignTypeFg:"#d9efff",callsignNumberBg:"#2879b9",callsignNumberFg:"#ffffff",tenCodeBg:"#164e63",tenCodeFg:"#cffafe",locationBg:"#334155",locationFg:"#dbeafe",rankBg:"#2879b9",rankFg:"#ffffff",nameBg:"#475569",nameFg:"#cbd5e1",tenCodeByCode:{"10-1":{bg:"#166534",fg:"#dcfce7"},"10-3":{bg:"#991b1b",fg:"#fee2e2"},"10-6":{bg:"#854d0e",fg:"#fef3c7"},"10-23":{bg:"#1e40af",fg:"#dbeafe"},"10-76":{bg:"#155e75",fg:"#cffafe"}}};
 if(method==="getPatrolTenCodes"){
  await authz(env,token,"patrols.view");
  const defaults=["10-1","10-3","10-6","10-23","10-76"];
  for(const key of ["patrol_ten_codes","ten_codes","patrol_status_codes"]){
   try{const rows=await db(env,"fib_mdt_settings",{query:{select:"value",key:`eq.${key}`,limit:"1"}});const value=rows?.[0]?.value;const list=Array.isArray(value)?value:(value&&Array.isArray(value.codes)?value.codes:null);if(list?.length)return {codes:list};}catch(e){}
  }
  return {codes:defaults};
 }
 if(method==="savePatrolTenCodes"){
  const au=await authz(env,token,"patrols.edit");
  const raw=Array.isArray(args[1])?args[1]:[];
  const codes=[...new Set(raw.map(v=>text(typeof v==="string"?v:(v?.code||v?.value||v?.name||""))).filter(v=>/^10-\d{1,2}$/.test(v)))];
  if(!codes.length)throw new Error("Mindestens ein gültiger Ten Code muss vorhanden sein.");
  if(codes.length>40)throw new Error("Es können höchstens 40 Ten Codes konfiguriert werden.");
  const existing=await db(env,"fib_mdt_settings",{query:{select:"key",key:"eq.patrol_ten_codes",limit:"1"}});
  if(existing?.length)await db(env,"fib_mdt_settings",{method:"PATCH",query:{key:"eq.patrol_ten_codes"},body:{value:codes,updated_at:new Date().toISOString(),updated_by:au.user.id},prefer:"return=minimal"});
  else await db(env,"fib_mdt_settings",{method:"POST",body:{key:"patrol_ten_codes",value:codes,updated_at:new Date().toISOString(),updated_by:au.user.id},prefer:"return=minimal"});
  return {success:true,codes};
 }
 if(method==="getPatrolDisplayConfig"){
  const au=await authz(env,token,"patrols.view");let colors={...PATROL_COLOR_DEFAULTS};
  try{const rows=await db(env,"fib_mdt_settings",{query:{select:"value",key:"eq.patrol_display_colors",limit:"1"}});if(rows?.[0]?.value&&typeof rows[0].value==="object")colors={...colors,...rows[0].value,tenCodeByCode:{...PATROL_COLOR_DEFAULTS.tenCodeByCode,...(rows[0].value.tenCodeByCode||{})}};}catch(e){/* SQL migration may not have been applied yet; defaults remain usable. */}
  return {master:au.master,colors};
 }
 if(method==="savePatrolDisplayConfig"){
  const au=await authz(env,token);if(!au.master)throw Object.assign(new Error("Nur der Master-Account darf die Darstellungsfarben ändern."),{status:403});
  const incoming=args[1]||{},colors={};for(const key of Object.keys(PATROL_COLOR_DEFAULTS)){if(key==="tenCodeByCode")continue;const value=String(incoming[key]||PATROL_COLOR_DEFAULTS[key]);if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error("Ungültiger Farbwert für "+key+".");colors[key]=value;}colors.tenCodeByCode={...PATROL_COLOR_DEFAULTS.tenCodeByCode};for(const [code,parts] of Object.entries(incoming.tenCodeByCode||{})){if(!/^10-\d{1,2}$/.test(code))continue;const bg=String(parts?.bg||colors.tenCodeByCode[code]?.bg||"#164e63"),fg=String(parts?.fg||colors.tenCodeByCode[code]?.fg||"#cffafe");if(!/^#[0-9a-f]{6}$/i.test(bg)||!/^#[0-9a-f]{6}$/i.test(fg))throw new Error("Ungültige Ten-Code-Farbe für "+code+".");colors.tenCodeByCode[code]={bg,fg};}
  const existing=await db(env,"fib_mdt_settings",{query:{select:"key",key:"eq.patrol_display_colors",limit:"1"}});
  if(existing?.length)await db(env,"fib_mdt_settings",{method:"PATCH",query:{key:"eq.patrol_display_colors"},body:{value:colors,updated_at:new Date().toISOString(),updated_by:au.user.id},prefer:"return=minimal"});
  else await db(env,"fib_mdt_settings",{method:"POST",body:{key:"patrol_display_colors",value:colors,updated_at:new Date().toISOString(),updated_by:au.user.id},prefer:"return=minimal"});
  return {success:true,colors};
 }
 // patrols
 if(method==="getPatrols"){
  await authz(env,token,"patrols.view");const [ps,ms,us,rs,people]=await Promise.all([
   db(env,"patrols",{query:{select:"*",order:"created_at.desc"}}),db(env,"patrol_members",{query:{select:"*"}}),
   db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image"}}),rankRows(env),
   db(env,"personnel",{query:{select:"user_id,call_sign,personnel_status"}})
  ]);
  return (ps||[]).map(p=>({...p,tenCode:p.ten_code||p.status,vehicleType:p.vehicle_type,members:(ms||[]).filter(m=>String(m.patrol_id)===String(p.id)).map(m=>{const u=(us||[]).find(x=>String(x.id)===String(m.user_id))||{};const person=(people||[]).find(x=>String(x.user_id)===String(m.user_id))||{};const r=(rs||[]).find(x=>String(x.id)===String(u.rank)||x.name===u.rank);return {id:u.id,name:u.name,username:u.username,rank:r?.name||u.rank||"Kein Rang",rankShortName:r?.short_name||r?.shortName||r?.name||u.rank||"Kein Rang",rankId:r?.id||u.rank,profileImage:u.profile_image||"",callSign:text(person.call_sign),position:m.position||"Member"};})}));
 }
 if(method==="getPatrolEligibleUsers"){
  await authz(env,token,"patrols.view");const [us,ms,rs,people]=await Promise.all([
   db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",active:"eq.true",approved:"eq.true",order:"name.asc"}}),
   db(env,"patrol_members",{query:{select:"user_id"}}),rankRows(env),
   db(env,"personnel",{query:{select:"user_id,call_sign,personnel_status"}})
  ]);const busy=new Set((ms||[]).map(m=>String(m.user_id)));return (us||[]).filter(u=>!busy.has(String(u.id))).map(u=>{const person=(people||[]).find(p=>String(p.user_id)===String(u.id))||{};return {...u,profileImage:u.profile_image||"",callSign:text(person.call_sign),personnelStatus:text(person.personnel_status),rank:(rs||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank)?.name||u.rank||"Kein Rang",rankShortName:(rs||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank)?.short_name||(rs||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank)?.name||u.rank||"Kein Rang"};});
 }
 if(method==="setPatrolTenCode"){
  const au=await authz(env,token,"patrols.view");const d=(args[0]&&typeof args[0]==="object"?args[0]:args[1])||{},pid=text(d.id||d.patrolId||d.patrol_id),code=text(d.tenCode||d.code||d.status);
  if(!pid||!code)throw new Error("Streifen-ID und Ten Code sind erforderlich.");
  const mine=await db(env,"patrol_members",{query:{select:"patrol_id,user_id",patrol_id:`eq.${pid}`}});
  if(!au.master&&!au.permissions.includes("patrols.edit")&&!mine.some(m=>String(m.user_id)===String(au.user.id)))throw Object.assign(new Error("Du darfst den Ten Code dieser Streife nicht ändern."),{status:403});
  await db(env,"patrols",{method:"PATCH",query:{id:`eq.${pid}`},body:{ten_code:code,updated_at:new Date().toISOString()},prefer:"return=minimal"});
  return {success:true,id:pid,tenCode:code};
 }
 if(["createPatrol","updatePatrol"].includes(method)){
  const au=await authz(env,token,method==="createPatrol"?"patrols.create":"patrols.edit");const d=args[1]||{},pid=text(d.id)||id("P"),now=new Date().toISOString();
  const requestedTenCode=text(d.tenCode||d.ten_code||d.status)||"10-1";const row={id:pid,callsign:text(d.callsign),number:text(d.number),vehicle_type:text(d.vehicleType),status:"10-1",ten_code:requestedTenCode,location:text(d.location),activity:text(d.activity),updated_at:now,updated_by:au.user.id};
  if(!row.callsign||!row.number||!row.vehicle_type||!row.status)throw new Error("Streifenkennung, Nummer, Fahrzeug und Status sind erforderlich.");
  const members=Array.isArray(d.members)?d.members.slice():[];
  // A duty status is personal: creating one automatically places the signed-in agent in the patrol.
  if(method==="createPatrol"&&!members.some(m=>text(m.id||m.user_id)===String(au.user.id))) members.unshift({id:au.user.id,position:"Lead"});
  const memberIds=[...new Set(members.map(m=>text(m.id||m.user_id)).filter(Boolean))];
  const leadCount=members.filter(m=>m.position==="Lead").length;if(leadCount>1)throw new Error("Eine Streife kann nur einen Streifenführer haben.");
  const validUsers=memberIds.length?await db(env,"users",{query:{select:"id,username,name,rank,active,approved,profile_image",id:`in.(${memberIds.join(",")})`,active:"eq.true",approved:"eq.true"}}):[];
  if(validUsers.length!==memberIds.length)throw new Error("Mindestens ein ausgewählter Agent ist nicht mehr aktiv oder freigegeben. Bitte aktualisiere die Mitgliederliste.");
  if(method==="createPatrol"){row.created_at=now;row.created_by=au.user.id;await db(env,"patrols",{method:"POST",body:row,prefer:"return=minimal"});}
  else {const existing=await db(env,"patrols",{query:{select:"id",id:`eq.${pid}`,limit:"1"}});if(!existing?.length)throw Object.assign(new Error("Die Streife wurde nicht gefunden. Bitte aktualisiere die Leitstelle."),{status:404});await db(env,"patrols",{method:"PATCH",query:{id:`eq.${pid}`},body:row,prefer:"return=minimal"});}
  await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`},prefer:"return=minimal"});
  if(memberIds.length)await db(env,"patrol_members",{method:"POST",body:memberIds.map(uid=>{const m=members.find(x=>text(x.id||x.user_id)===uid)||{};return {patrol_id:pid,user_id:uid,position:m.position==="Lead"?"Lead":"Member"};}),prefer:"return=minimal"});
  const ranks=await rankRows(env);const enriched=memberIds.map(uid=>{const u=validUsers.find(x=>String(x.id)===uid)||{},m=members.find(x=>text(x.id||x.user_id)===uid)||{},r=(ranks||[]).find(x=>String(x.id)===String(u.rank)||x.name===u.rank);return {id:u.id,name:u.name,username:u.username,rank:r?.name||u.rank||"Kein Rang",rankShortName:r?.short_name||r?.name||u.rank||"Kein Rang",rankId:r?.id||u.rank,profileImage:u.profile_image||"",position:m.position==="Lead"?"Lead":"Member"};});
  return {success:true,patrol:{...row,id:pid,tenCode:row.ten_code,vehicleType:row.vehicle_type,members:enriched}};
 }
 if(method==="joinPatrol"){
  const au=await authz(env,token,"patrols.view"),pid=text(args[1]);
  const [patrol,profile,existing]=await Promise.all([
   db(env,"patrols",{query:{select:"id",id:`eq.${pid}`,limit:"1"}}),
   db(env,"personnel",{query:{select:"user_id,call_sign",user_id:`eq.${au.user.id}`,limit:"1"}}),
   db(env,"patrol_members",{query:{select:"patrol_id,user_id",user_id:`eq.${au.user.id}`,limit:"1"}})
  ]);
  if(!patrol?.length)throw new Error("Diese Streife existiert nicht mehr.");
  if(existing?.length)throw new Error(String(existing[0].patrol_id)===pid?"Du bist bereits dieser Streife zugeordnet.":"Du bist bereits einer anderen Streife zugeordnet. Beende zuerst deinen aktuellen Dienst.");
  const users=await db(env,"users",{query:{select:"id,active,approved",id:`eq.${au.user.id}`,active:"eq.true",approved:"eq.true",limit:"1"}});
  if(!users?.length)throw new Error("Dein Benutzerkonto ist nicht aktiv oder nicht freigegeben.");
  await db(env,"patrol_members",{method:"POST",body:{patrol_id:pid,user_id:au.user.id,position:"Member"},prefer:"return=minimal"});
  return {success:true,patrolId:pid,callSign:text(profile?.[0]?.call_sign)};
 }
 if(method==="leavePatrol"){
  const au=await authz(env,token),mine=await db(env,"patrol_members",{query:{select:"patrol_id",user_id:`eq.${au.user.id}`,limit:"1"}});
  if(!mine?.length)return {success:true,alreadyOffDuty:true};
  const pid=text(mine[0].patrol_id);
  await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`,user_id:`eq.${au.user.id}`},prefer:"return=minimal"});
  const remaining=await db(env,"patrol_members",{query:{select:"user_id",patrol_id:`eq.${pid}`}});
  if(!remaining?.length)await db(env,"patrols",{method:"DELETE",query:{id:`eq.${pid}`},prefer:"return=minimal"});
  return {success:true,patrolId:pid,patrolClosed:!remaining?.length};
 }
 if(method==="deletePatrol"){await authz(env,token,"patrols.delete");const pid=text(args[1]);await db(env,"patrol_members",{method:"DELETE",query:{patrol_id:`eq.${pid}`},prefer:"return=minimal"});await db(env,"patrols",{method:"DELETE",query:{id:`eq.${pid}`},prefer:"return=minimal"});return {success:true};}
 // records: security is enforced on every operation
 if(method==="getRecordsConfig"){await authz(env,token);return {listLimit:50,maxListLimit:100,deleteMasterOnly:true,statuses:[{id:"open",label:"Offen"},{id:"in_progress",label:"In Bearbeitung"},{id:"closed",label:"Abgeschlossen"},{id:"archived",label:"Archiviert"}],types:[{id:"investigation",label:"Ermittlungsakten",permissions:{view:"records.investigations.view",create:"records.investigations.create",edit:"records.investigations.edit"}},{id:"report",label:"Berichte",permissions:{view:"records.reports.view",create:"records.reports.create",edit:"records.reports.edit"}},{id:"doc",label:"Gesicherte DOC-Akten",permissions:{view:"records.doc.view",create:"records.doc.create",edit:"records.doc.edit"}},{id:"director",label:"Office of the Chief of Police",permissions:{view:"records.director.view",create:"records.director.create",edit:"records.director.edit"}}]};}
 if(method==="getRecords"){const au=await authz(env,token);const view=text(args[1]),status=text(args[2]),search=text(args[3]),limit=Math.min(100,Math.max(1,Number(args[4])||50));const perm={investigation:"records.investigations.view",report:"records.reports.view",doc:"records.doc.view",director:"records.director.view"};let types=Object.keys(perm).filter(t=>au.master||au.permissions.includes(perm[t]));if(view&&view!=="all")types=types.filter(t=>t===view);if(!types.length)return [];const q={select:"id,case_number,type,title,subject,status,classification,summary,created_at,created_by,created_by_name,updated_at,updated_by,updated_by_name,archived_at",type:`in.(${types.join(",")})`,order:"updated_at.desc",limit:String(limit)};if(status&&status!=="all")q.status=`eq.${status}`;if(search)q.or=`(title.ilike.*${search}*,subject.ilike.*${search}*,summary.ilike.*${search}*)`;return await db(env,"fib_records",{query:q});}
 if(method==="getRecord"){const au=await authz(env,token);const rows=await db(env,"fib_records",{query:{select:"*",id:`eq.${text(args[1])}`,limit:"1"}});const r=rows?.[0];if(!r)throw new Error("Akte nicht gefunden.");const perm={investigation:"records.investigations.view",report:"records.reports.view",doc:"records.doc.view",director:"records.director.view"};if(!au.master&&!au.permissions.includes(perm[r.type]))throw Object.assign(new Error("Keine Berechtigung für diese Akte."),{status:403});return r;}
 if(["createRecord","updateRecord","archiveRecord","deleteRecord"].includes(method)){const au=await authz(env,token);const rid=text(args[1]),d=(method==="createRecord"?args[1]:args[2])||{};if(method==="deleteRecord"){if(!au.master)throw Object.assign(new Error("Nur Master dürfen Akten endgültig löschen."),{status:403});await db(env,"fib_records",{method:"DELETE",query:{id:`eq.${text(args[1])}`},prefer:"return=minimal"});return {success:true};}const type=text(method==="createRecord"?d.type:(method==="archiveRecord"?args[2]:(d.type||d.recordType))).toLowerCase();const perms={investigation:"records.investigations",report:"records.reports",doc:"records.doc",director:"records.director"};const base=perms[type];if(!base)throw new Error("Ungültige Aktenart.");const action=method==="createRecord"?"create":"edit";if(!au.master&&!au.permissions.includes(`${base}.${action}`))throw Object.assign(new Error("Keine Berechtigung für diese Aktion."),{status:403});const now=new Date().toISOString();if(method==="createRecord"){if(!text(d.title))throw new Error("Titel ist erforderlich.");const row={id:id("R"),case_number:`LSPD-${new Date().getFullYear()}-${Math.floor(10000+Math.random()*90000)}`,type,title:text(d.title),subject:text(d.subject),status:text(d.status)||"open",classification:type==="director"?"Streng vertraulich – Office of the Chief of Police":type==="doc"?"Geschützt – DOC":"Intern",summary:text(d.summary),content:String(d.content||""),created_by:au.user.id,created_by_name:au.user.name,updated_by:au.user.id,updated_by_name:au.user.name,created_at:now,updated_at:now};const rows=await db(env,"fib_records",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return rows?.[0]||row;}if(method==="archiveRecord"){const rows=await db(env,"fib_records",{method:"PATCH",query:{id:`eq.${rid}`,type:`eq.${type}`,select:"*"},body:{status:"archived",archived_at:now,archived_by:au.user.id,archived_by_name:au.user.name,updated_at:now},prefer:"return=representation"});if(!rows?.length)throw new Error("Akte nicht gefunden.");return rows[0];}const patch={updated_at:now,updated_by:au.user.id,updated_by_name:au.user.name};for(const k of ["title","subject","summary","content","status"])if(d[k]!==undefined)patch[k]=d[k];const rows=await db(env,"fib_records",{method:"PATCH",query:{id:`eq.${rid}`,type:`eq.${type}`,select:"*"},body:patch,prefer:"return=representation"});if(!rows?.length)throw new Error("Akte nicht gefunden.");return rows[0];}
 // Wanted records (Supabase table: wanted)
 if(method==="getWantedConfig"){const au=await authz(env,token,"wanted.view");return {master:au.master,permissions:{view:await has(env,au,"wanted.view"),create:await has(env,au,"wanted.create"),edit:await has(env,au,"wanted.edit"),delete:await has(env,au,"wanted.delete")},types:[{id:"person",label:"Person"},{id:"vehicle",label:"Fahrzeug"}],statuses:[{id:"wanted",label:"Gesucht",className:"active"},{id:"observation",label:"Beobachtung",className:"watch"},{id:"captured",label:"Gefasst",className:"captured"}],dangerLevels:[{id:"low",label:"Niedrig"},{id:"medium",label:"Mittel"},{id:"high",label:"Hoch"},{id:"extreme",label:"Sehr hoch"}]};}
 if(method==="getWanted"||method==="getWantedEntries"){await authz(env,token,"wanted.view");const search=text(args[1]);const q={select:"*",order:"created_at.desc",limit:String(Math.min(200,Math.max(1,Number(args[2])||100)))};if(search)q.or=`(name.ilike.*${search}*,plate.ilike.*${search}*,reason.ilike.*${search}*,description.ilike.*${search}*)`;return await db(env,"fib_wanted",{query:q});}
 if(method==="getWantedEntry"){await authz(env,token,"wanted.view");const r=await db(env,"fib_wanted",{query:{select:"*",id:`eq.${text(args[1])}`,limit:"1"}});if(!r?.length)throw new Error("Fahndung nicht gefunden.");return r[0];}
 if(method==="createWanted"){const au=await authz(env,token,"wanted.create");const d=args[1]||{};if(!text(d.name))throw new Error("Name ist erforderlich.");const row={...d,id:id("W"),created_by_id:au.user.id,created_by:au.user.name,created_at:new Date().toISOString(),status:d.status||"Active"};const r=await db(env,"fib_wanted",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;}
 if(method==="updateWanted"){const au=await authz(env,token,"wanted.edit");const d=args[2]||{};const r=await db(env,"fib_wanted",{method:"PATCH",query:{id:`eq.${text(args[1])}`,select:"*"},body:{...d,updated_at:new Date().toISOString(),updated_by:au.user.name},prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="deleteWanted"){await authz(env,token,"wanted.delete");await db(env,"fib_wanted",{method:"DELETE",query:{id:`eq.${text(args[1])}`},prefer:"return=minimal"});return {success:true};}
 // classifications
 if(method==="getClassificationPermissions"){const au=await authz(env,token);return {master:au.master,permissions:au.permissions};}
 if(method==="getClassifications"){await authz(env,token,"classifications.view");const search=text(args[1]),limit=String(Math.min(200,Math.max(1,Number(args[2])||100)));const [requests,persons]=await Promise.all([db(env,"classification_requests",{query:{select:"*",order:"requested_at.desc",limit}}),db(env,"classified_persons",{query:{select:"*",order:"added_at.desc",limit}})]);const match=x=>!search||Object.values(x).some(v=>String(v??"").toLowerCase().includes(search.toLowerCase()));return {requests:(requests||[]).filter(match),persons:(persons||[]).filter(match)};}
 if(method==="approveClassificationRequest"||method==="rejectClassificationRequest"){const au=await authz(env,token,"classifications.approve");const rid=text(args[1]),reason=text(args[2]);const rows=await db(env,"classification_requests",{query:{select:"*",id:`eq.${rid}`,limit:"1"}});const r=rows?.[0];if(!r)throw new Error("Antrag nicht gefunden.");const status=method==="approveClassificationRequest"?"approved":"rejected";await db(env,"classification_requests",{method:"PATCH",query:{id:`eq.${rid}`},body:{status,reviewed_by_user_id:au.user.id,reviewed_by_name:au.user.name,review_reason:reason,reviewed_at:new Date().toISOString()},prefer:"return=minimal"});if(status==="approved")await db(env,"classified_persons",{method:"POST",body:{id:id("CLS"),person_name:r.person_name,passport_number:r.passport_number,rank_function:r.rank_function||"",organization:r.organization,reason:r.reason,source_request_id:r.id,added_by_user_id:au.user.id,added_by_name:au.user.name,added_at:new Date().toISOString()},prefer:"return=minimal"});return {success:true};}
 if(method==="addClassifiedPerson"){const au=await authz(env,token,"classifications.create");const d=args[1]||{};const row={id:id("CLS"),person_name:text(d.person_name||d.personName),passport_number:text(d.passport_number||d.passportNumber),rank_function:text(d.rank_function||d.rankFunction),organization:text(d.organization),reason:text(d.reason),added_by_user_id:au.user.id,added_by_name:au.user.name,added_at:new Date().toISOString()};const r=await db(env,"classified_persons",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;}
 if(method==="deleteClassifiedPerson"){await authz(env,token,"classifications.delete");await db(env,"classified_persons",{method:"DELETE",query:{id:`eq.${text(args[1])}`},prefer:"return=minimal"});return {success:true};}
 // External record sharing. Tokens are only stored as SHA-256 hashes.
 if(method==="createRecordShare") {const au=await authz(env,token);const rid=text(args[1]),minutes=Math.min(10080,Math.max(5,Number(args[2])||60));const rows=await db(env,"fib_records",{query:{select:"id,type",id:`eq.${rid}`,limit:"1"}});const rec=rows?.[0];if(!rec)throw new Error("Akte nicht gefunden.");const viewPerm={investigation:"records.investigations.view",report:"records.reports.view",doc:"records.doc.view",director:"records.director.view"}[rec.type];if(!au.master&&!au.permissions.includes(viewPerm))throw Object.assign(new Error("Keine Berechtigung für diese Akte."),{status:403});const raw=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join("");const share={id:id("SH"),record_id:rid,token_hash:await sha256(raw),created_by:au.user.id,created_by_name:au.user.name,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+minutes*60000).toISOString(),revoked_at:null};await db(env,"fib_record_shares",{method:"POST",body:share,prefer:"return=minimal"});return {success:true,token:raw,expiresAt:share.expires_at,url:`/?recordShare=${raw}`};}
 if(method==="getRecordShares") {const au=await authz(env,token);const rid=text(args[1]);const rows=await db(env,"fib_record_shares",{query:{select:"id,record_id,created_by,created_by_name,created_at,expires_at,revoked_at",record_id:`eq.${rid}`,order:"created_at.desc"}});return (rows||[]).map(r=>({...r,active:!r.revoked_at&&Date.parse(r.expires_at)>Date.now()}));}
 if(method==="revokeRecordShare") {await authz(env,token);await db(env,"fib_record_shares",{method:"PATCH",query:{id:`eq.${text(args[1])}`},body:{revoked_at:new Date().toISOString()},prefer:"return=minimal"});return {success:true};}
 if(method==="getExternalRecord") {const raw=text(args[0]);if(!raw)throw new Error("Ungültiger Freigabe-Link.");const shares=await db(env,"fib_record_shares",{query:{select:"id,record_id,expires_at,revoked_at",token_hash:`eq.${await sha256(raw)}`,limit:"1"}});const sh=shares?.[0];if(!sh||sh.revoked_at||Date.parse(sh.expires_at)<=Date.now())throw Object.assign(new Error("Diese externe Aktenfreigabe ist ungültig oder abgelaufen."),{status:404});const records=await db(env,"fib_records",{query:{select:"id,case_number,type,title,subject,status,classification,summary,content,created_at,created_by_name,updated_at,updated_by_name",id:`eq.${sh.record_id}`,limit:"1"}});if(!records?.length)throw Object.assign(new Error("Akte nicht gefunden."),{status:404});return records[0];}
 if(method==="getDashboardStatistics"){
  const au=await authz(env,token);
  const [users,records,warrants,wanted,patrols]=await Promise.all([
   db(env,"users",{query:{select:"id,active,approved"}}),
   db(env,"fib_records",{query:{select:"id,status"}}).catch(()=>[]),
   googleSheetsCall(env,"getWarrants",[token]).catch(()=>[]),
   db(env,"fib_wanted",{query:{select:"id,status"}}).catch(()=>[]),
   db(env,"patrols",{query:{select:"id,status"}}).catch(()=>[])
  ]);
  const active=(users||[]).filter(x=>x.active===true&&x.approved===true).length;
  return {agents:active,activeAgents:active,users:active,activeUsers:active,totalAgents:(users||[]).length,records:(records||[]).length,openRecords:(records||[]).filter(x=>!['closed','archived'].includes(String(x.status||'').toLowerCase())).length,warrants:(warrants||[]).length,openWarrants:(warrants||[]).filter(x=>!['closed','resolved','cancelled'].includes(String(x.status||'').toLowerCase())).length,wanted:(wanted||[]).length,activeWanted:(wanted||[]).filter(x=>!['closed','resolved','cancelled','inactive'].includes(String(x.status||'').toLowerCase())).length,searches:(wanted||[]).filter(x=>!['closed','resolved','cancelled','inactive'].includes(String(x.status||'').toLowerCase())).length,patrols:(patrols||[]).length,activePatrols:(patrols||[]).filter(x=>!['closed','ended','inactive'].includes(String(x.status||'').toLowerCase())).length};
 }
 // Rank lookup remains in Supabase; legacy sheet modules are handled above.
 if(method==="getRankById"){await authz(env,token);const rows=await db(env,"ranks",{query:{select:"*",id:`eq.${text(args[1])}`,limit:"1"}});return rows?.[0]||null;}
 // System administration
 if(method==="systemGetUsers"){await authz(env,token,"system.users.view");const [us,rs]=await Promise.all([db(env,"users",{query:{select:"id,username,name,rank,active,approved,master,profile_image",order:"name.asc"}}),rankRows(env)]);return (us||[]).map(u=>({...u,rank_name:(rs||[]).find(r=>String(r.id)===String(u.rank)||r.name===u.rank)?.name||u.rank||"Kein Rang"}));}
 if(method==="systemGetUserRanks"||method==="systemGetAllRanks"){await authz(env,token,"system.ranks.view");return await rankRows(env);}
 if(method==="systemGetPermissions"){await authz(env,token,"system.permissions.view");return await db(env,"permissions",{query:{select:"*",order:"key.asc"}});}
 if(method==="systemGetRankPermissions"){await authz(env,token,"system.permissions.view");const links=await db(env,"rank_permissions",{query:{select:"permission_id",rank_id:`eq.${text(args[1])}`}});return (links||[]).map(x=>x.permission_id);}
 if(method==="systemSetRankPermissions"){await authz(env,token,"system.permissions.manage");const rid=text(args[1]),selected=Array.isArray(args[2])?args[2]:[];await db(env,"rank_permissions",{method:"DELETE",query:{rank_id:`eq.${rid}`},prefer:"return=minimal"});if(selected.length)await db(env,"rank_permissions",{method:"POST",body:selected.map(pid=>({rank_id:rid,permission_id:text(pid)})),prefer:"return=minimal"});return {success:true};}
 if(method==="systemCreateRank"){await authz(env,token,"system.ranks.manage");const d=args[1]||{};const row={id:text(d.id)||id("R"),name:text(d.name||d.Name),short_name:text(d.shortName||d.short_name||d.ShortName),level:Number(d.level||d.Level||0),active:d.active!==false&&d.Active!==false};const r=await db(env,"ranks",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;}
 if(method==="systemUpdateRank"){await authz(env,token,"system.ranks.manage");const rid=text(args[1]),d=args[2]||{};const patch={};for(const [k,keys] of Object.entries({name:["name","Name"],short_name:["shortName","short_name","ShortName"],level:["level","Level"],active:["active","Active"]})){const found=keys.find(x=>d[x]!==undefined);if(found)patch[k]=k==="level"?Number(d[found]):k==="active"?(d[found]===true||String(d[found]).toLowerCase()==="true"):text(d[found]);}const r=await db(env,"ranks",{method:"PATCH",query:{id:`eq.${rid}`,select:"*"},body:patch,prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="systemCreatePermission"){
  await authz(env,token,"system.permissions.manage");const d=args[1]||{};const key=text(d.key||d.permission||d.name),name=text(d.name||d.label||key),label=text(d.label||d.name||key);
  if(!key)throw new Error("Berechtigungsschlüssel fehlt.");if(!name)throw new Error("Name der Berechtigung fehlt.");
  const row={id:text(d.id)||id("PERM"),key,name,label,description:text(d.description),category:text(d.category)};
  const r=await db(env,"permissions",{method:"POST",query:{select:"*"},body:row,prefer:"return=representation"});return r?.[0]||row;
 }
 if(method==="systemUpdatePermission"){
  await authz(env,token,"system.permissions.manage");const d=args[2]||{};const patch={};for(const k of ["key","name","label","description","category"])if(d[k]!==undefined)patch[k]=text(d[k]);
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
   ["personnel_trainings","id,user_id,name,category,date,instructor,status,expiry_date,notes,created_by,created_by_name,created_at"],
   ["personnel_notes","id,user_id,type,title,content,created_by,created_by_name,created_at"],
   ["fib_records","id,case_number,type,title,subject,status,classification,summary,content,created_at"],
   ["fib_wanted","id,status"],["classification_requests","id"],["classified_persons","id"],
   ["fib_record_shares","id,record_id,token_hash,expires_at,revoked_at"],
   ["fib_announcements","id,title,description,status,event_date,metadata,created_at"],
   ["fib_vacations","id,title,description,status,event_date,metadata,created_at"],
   ["fib_internal_fines","id,title,description,status,event_date,metadata,created_at"],
   ["fib_internal_fine_catalog","id,item_type,category_id,title,description,amount,sanction_type,sanction_value,sanction_unit,sanction_components,active,sort_order,created_at,updated_at,created_by"],
   ["fib_calendar_events","id,title,description,status,event_date,metadata,created_at"],
   ["fib_gang_profiles","id,title,description,status,event_date,metadata,created_at"],
   ["fib_bonus_entries","id,title,description,status,event_date,metadata,created_at"],
   ["fib_mdt_logs","id,action,module_name,item_id,detail,actor_id,actor_name,created_at"]
  ];
  const checks=await Promise.all(specs.map(async([table,columns])=>{try{await db(env,table,{query:{select:columns,limit:"0"}});return {table,ok:true};}catch(e){return {table,ok:false,error:String(e?.message||e).slice(0,240)};}}));
  return {success:true,checkedAt:new Date().toISOString(),checks,failed:checks.filter(x=>!x.ok),googleSheets:{configured:Boolean(String(env.GOOGLE_SHEETS_API_URL||"").trim())}};
 }
 if(method==="systemCreateUser"){await authz(env,token,"system.users.manage");const d=args[1]||{};const username=text(d.username||d.Username),name=text(d.name||d.Name),password=String(d.password||d.Password||"");if(!username||!name||!password)throw new Error("Benutzername, Name und Passwort sind erforderlich.");const salt=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join("");const row={id:id("U"),username,name,rank:text(d.rankId||d.rank)||null,password_salt:salt,password_hash:await sha256(salt+password),active:d.active!==false,approved:d.approved!==false,master:d.master===true,created_at:new Date().toISOString()};const r=await db(env,"users",{method:"POST",query:{select:"id,username,name,rank,active,approved,master"},body:row,prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="systemUpdateUser"){await authz(env,token,"system.users.manage");const uid=text(args[1]),d=args[2]||{},patch={};for(const k of ["name","username","rank","active","approved","master"])if(d[k]!==undefined)patch[k]=d[k];if(d.rankId!==undefined)patch.rank=d.rankId;const r=await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`,select:"id,username,name,rank,active,approved,master"},body:patch,prefer:"return=representation"});return r?.[0]||{success:true};}
 if(method==="systemApproveUser"){await authz(env,token,"system.users.manage");const uid=text(args[1]),rank=text(args[2]);await db(env,"users",{method:"PATCH",query:{id:`eq.${uid}`},body:{rank:rank||null,active:true,approved:true},prefer:"return=minimal"});return {success:true};}
 if(method==="systemDeactivateUser"){await authz(env,token,"system.users.manage");await db(env,"users",{method:"PATCH",query:{id:`eq.${text(args[1])}`},body:{active:false},prefer:"return=minimal"});return {success:true};}
 throw Object.assign(new Error(`Serverfunktion „${method}“ ist noch nicht implementiert.`),{status:501,code:"NOT_MIGRATED"});
}
export async function onRequest({request,env}){
 if(request.method==="OPTIONS")return new Response(null,{status:204});
 const url=new URL(request.url);try{
  if(url.pathname.startsWith("/api/auth/")){if(request.method!=="POST")return bad("Methode nicht erlaubt.",405);const p=await readJson(request);const result=await handleAuth(url.pathname.slice("/api/auth/".length),request,env,p);if(result)return result;}
  if(url.pathname==="/api/public/classification-request") {
   // The public application endpoint exposes only the approved organization list.
   const allowedOrganizations=["SAHP","SANG","FIB","LI","GOV","EMS","LSPD"];
   if(request.method==="GET") return json({success:true,organizations:allowedOrganizations});
   if(request.method!=="POST") return bad("Methode nicht erlaubt.",405);

   const d=await readJson(request);
   const applicant=text(d.applicant||d.requested_by_name||d.contact);
   const organization=text(d.organization);
   const persons=Array.isArray(d.persons)
    ? d.persons
    : [{person_name:d.person_name,passport_number:d.passport_number,rank_function:d.rank_function,reason:d.reason}];

   if(!applicant||!organization||!persons.length)
    return bad("Bitte Antragsteller, Organisation und mindestens eine Person angeben.");
   if(applicant.length>160||organization.length>120)
    return bad("Mindestens ein Feld überschreitet die zulässige Länge.");
   if(!allowedOrganizations.includes(organization))
    return bad("Bitte eine gültige Organisation aus der Auswahlliste auswählen.");
   if(persons.length>30)
    return bad("Ein Gruppenantrag darf höchstens 30 Personen enthalten.");

   const normalized=persons.map(person=>({
    person_name:text(person?.person_name||person?.name),
    passport_number:text(person?.passport_number||person?.passport),
    rank_function:text(person?.rank_function||person?.rank||person?.function),
    reason:text(person?.reason)
   }));
   if(normalized.some(person=>!person.person_name||!person.passport_number||!person.rank_function||!person.reason))
    return bad("Bitte für jede Person Name, Reisepassnummer, Rang/Funktion und eine individuelle Begründung angeben.");
   if(normalized.some(person=>person.person_name.length>120||person.passport_number.length>40||person.rank_function.length>160||person.reason.length>5000))
    return bad("Name, Reisepassnummer, Rang/Funktion oder Begründung überschreitet die zulässige Länge.");
   const passportKeys=normalized.map(person=>person.passport_number.toLowerCase());
   if(new Set(passportKeys).size!==passportKeys.length)
    return bad("Eine Reisepassnummer wurde im Gruppenantrag mehrfach angegeben.");

   const now=new Date().toISOString();
   const rows=normalized.map(person=>({
    id:id("CR"),
    person_name:person.person_name,
    passport_number:person.passport_number,
    rank_function:person.rank_function,
    organization,
    reason:person.reason,
    status:"pending",
    requested_at:now,
    requested_by_name:applicant
   }));
   const saved=await db(env,"classification_requests",{
    method:"POST",
    query:{select:"id,status,requested_at,person_name,passport_number,rank_function"},
    body:rows,
    prefer:"return=representation"
   });
   const requests=Array.isArray(saved)?saved:rows.map(row=>({id:row.id,status:row.status,requested_at:now,person_name:row.person_name,passport_number:row.passport_number,rank_function:row.rank_function}));
   return json({success:true,count:requests.length,requests});
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
   const typeLabels={investigation:"Ermittlungsakte",report:"Bericht",doc:"Dienstliche Dokumentation",director:"Direktionsakte"};
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
  if(url.pathname.startsWith("/api/legacy/")){if(request.method!=="POST")return bad("Methode nicht erlaubt.",405);const p=await readJson(request);const method=decodeURIComponent(url.pathname.slice("/api/legacy/".length));const callArgs=Array.isArray(p.args)?p.args:[];const result=await dispatch(method,callArgs,env,bearer(request,p));return json(result);}
  if(url.pathname==="/api/health") {
   // Real connectivity check; never return credentials or the Supabase project URL.
   config(env);
   const deep=url.searchParams.get("deep")==="1";
   const required=deep
    ? ["users","ranks","permissions","rank_permissions","fib_mdt_sessions","fib_records","patrols","fib_wanted","classification_requests","classified_persons","patrol_members","personnel","personnel_notes","personnel_trainings","fib_record_shares","fib_announcements","fib_vacations","fib_internal_fines","fib_internal_fine_catalog","fib_vehicle_catalog","fib_calendar_events","fib_gang_profiles","fib_bonus_entries","fib_mdt_logs"]
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
