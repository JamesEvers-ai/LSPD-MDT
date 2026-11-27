import {db} from './supabase.js';
const META='id,title,category,status,version,updated_at,updated_by_name';
const TABLE='lspd_service_regulations', HISTORY='lspd_service_regulation_versions';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const effective=(a,p)=>a.master||((a.permissions.includes('*')||a.permissions.includes(p))&&(!a.departmentScopedPermissions.includes(p)||a.departmentPermissions.includes(p)));
const str=x=>String(x??'').trim();
const identifier=x=>{const s=str(x);if(!/^REG[A-Z0-9]{14}$/.test(s))throw error('Ungültige Vorschriften-ID.');return s;};
const page=x=>Math.max(0,Math.min(100000,Math.floor(Number(x)||0)));
export async function regulationDispatch(method,args,env,token,authz){
 if(!['getRegulations','getRegulation','getRegulationHistory','getRegulationVersion','saveRegulation'].includes(method))return undefined;
 const au=await authz(env,token,'regulations.view');
 const manage=effective(au,'regulations.manage');
 if(['getRegulationHistory','getRegulationVersion','saveRegulation'].includes(method)&&!manage)throw error('Keine Verwaltungsberechtigung.',403);
 if(method==='getRegulations'){
  const d=args[1]||{},offset=page(d.offset),q={select:META,order:'updated_at.desc,id.asc',offset:String(offset),limit:'51'};
  if(!manage)q.status='eq.published';else if(['draft','published','archived'].includes(d.status))q.status='eq.'+d.status;
  const search=str(d.search).slice(0,100).replace(/[^\p{L}\p{N}\s-]/gu,' ').trim();if(search)q.or=`(title.ilike.*${search}*,category.ilike.*${search}*)`;
  const rows=await db(env,TABLE,{query:q});return {items:rows.slice(0,50),hasMore:rows.length>50,canManage:manage};
 }
 if(method==='getRegulation'){
  const q={select:META+',content',id:'eq.'+identifier(args[1]),limit:'1'};if(!manage)q.status='eq.published';
  const rows=await db(env,TABLE,{query:q});if(!rows.length)throw error('Dienstvorschrift nicht gefunden.',404);return rows[0];
 }
 if(method==='getRegulationHistory'){
  const rows=await db(env,HISTORY,{query:{select:'regulation_id,version,title,category,status,updated_at,updated_by_name',regulation_id:'eq.'+identifier(args[1]),order:'version.desc',offset:String(page(args[2])),limit:'51'}});return {items:rows.slice(0,50),hasMore:rows.length>50};
 }
 if(method==='getRegulationVersion'){
  const version=Number(args[2]);if(!Number.isSafeInteger(version)||version<1)throw error('Ungültige Version.');
  const rows=await db(env,HISTORY,{query:{select:'regulation_id,version,title,category,status,content,updated_at,updated_by_name',regulation_id:'eq.'+identifier(args[1]),version:'eq.'+version,limit:'1'}});if(!rows.length)throw error('Version nicht gefunden.',404);return rows[0];
 }
 const d=args[1]||{},title=str(d.title),category=str(d.category),content=str(d.content),status=str(d.status);
 if(!title||title.length>180||!category||category.length>100||!content||content.length>60000||!['draft','published','archived'].includes(status))throw error('Bitte Titel, Kategorie, Inhalt und gültigen Status angeben (max. 60.000 Zeichen Inhalt).');
 const patch={title,category,content,status,updated_by:au.user.id,updated_by_name:au.user.name||''};
 if(!d.id){if(status==='archived')throw error('Neue Vorschriften können nicht direkt archiviert werden.');const rows=await db(env,TABLE,{method:'POST',query:{select:META},body:{...patch,id:'REG'+crypto.randomUUID().replace(/-/g,'').slice(0,14).toUpperCase()},prefer:'return=representation'});return rows[0];}
 const version=Number(d.version);if(!Number.isSafeInteger(version)||version<1)throw error('Versionsnummer fehlt.');
 const rows=await db(env,TABLE,{method:'PATCH',query:{id:'eq.'+identifier(d.id),version:'eq.'+version,select:META},body:patch,prefer:'return=representation'});
 if(!rows.length)throw error('Die Dienstvorschrift wurde zwischenzeitlich geändert. Bitte öffne sie erneut. Dein Entwurf bleibt erhalten.',409);return rows[0];
}
