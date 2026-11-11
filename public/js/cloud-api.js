/* LSPD MDT Cloudflare adapter: page-template preload + central response cache. */
(() => {
  "use strict";
  const TOKEN_KEY = "fib_mdt_session";
  const pages = {
    Page_Dashboard:"dashboard.html", Page_Agents:"agents.html", Page_System:"system.html",
    Page_Patrols:"patrols.html", Page_Records:"records.html", "Page_Records(2)":"records.html",
    Page_Announcements:"announcements.html", Page_Vacations:"vacations.html", Page_IFines:"ifines.html", Page_VehicleCatalog:"vehicle-catalog.html",
    Page_Fines:"fines.html", Page_Lawyers:"lawyers.html", Page_Warrants:"warrants.html",
    Page_Wanted:"wanted.html", Page_Calendar:"calendar.html", Page_Classification:"classification.html",
    Page_Classifications:"classification.html", Page_Gangs:"gangs.html", Page_Bonuses:"bonuses.html", Page_Logs:"logs.html"
  };
  const templateCache = new Map();
  const templateInflight = new Map();
  const dataCache = new Map();
  const DATA_TTL_MS = 8_000;
  const PREFETCH_DATA_TTL_MS = 2 * 60 * 1000;
  const PREFETCHABLE_SHEET_READS = new Set(["getFines", "getLawyers", "getWarrants", "getPersonnelList", "getPersonnelRankOptions"]);
  let cacheEpoch = 0;
  const inflightReads = new Map();
  const LIVE_OR_AUTH_READS = new Set([
    "getCurrentUser", "getSessionInfo", "getMyPermissions", "getPatrols",
    "getDashboardStats", "getDashboardStatistics", "getActivePatrols",
    "getLivePatrols", "getCurrentSession", "getNotifications",
    "getWarrantStatistics"
  ]);
  let lastToken = null;

  function err(payload,status){ const e=new Error(payload?.message||payload?.error||`API-Fehler (HTTP ${status})`); e.status=status; e.code=payload?.code; return e; }
  function getToken(){ return sessionStorage.getItem(TOKEN_KEY)||""; }
  function clearDataCache(){ dataCache.clear(); cacheEpoch++; }
  function isCacheableRead(method){
    if (LIVE_OR_AUTH_READS.has(method)) return false;
    return /^(get|list|load|systemGet|dashboardGet|fetch)[A-Z_]/.test(method);
  }
  function stableKey(method,args,token){
    let encoded;
    try { encoded=JSON.stringify(args); } catch { encoded=String(args); }
    return `${token}\u0000${method}\u0000${encoded}`;
  }
  async function fetchTemplate(filename){
    if(templateCache.has(filename)) return templateCache.get(filename);
    if(templateInflight.has(filename)) return templateInflight.get(filename);
    const task=(async()=>{
      const response=await fetch(`/pages/${filename}`,{credentials:"same-origin",headers:{Accept:"text/html"}});
      const body=await response.text();
      if(!response.ok) throw err({message:body||`Seite ${filename} konnte nicht geladen werden.`},response.status);
      if(!body.trim()) throw new Error(`Die Seitendatei ${filename} ist leer.`);
      templateCache.set(filename,body);
      return body;
    })();
    templateInflight.set(filename,task);
    try { return await task; } finally { templateInflight.delete(filename); }
  }
  async function preloadPages(){
    const filenames=[...new Set(Object.values(pages))];
    const results=await Promise.allSettled(filenames.map(fetchTemplate));
    const failed=results.filter(x=>x.status==="rejected");
    if(failed.length) console.warn(`[LSPD MDT] ${failed.length} Seitentemplate(s) konnten nicht vorab geladen werden. Sie werden beim Öffnen erneut versucht.`,failed.map(x=>x.reason));
    return {loaded:results.length-failed.length,total:results.length,failed:failed.length};
  }
  async function invoke(method,args){
    if(method === "include") {
      const key=String(args[0]||"").replace(/\.html$/i,"");
      const filename=pages[key];
      if(!filename) throw new Error(`Seite nicht freigegeben: ${key}`);
      return fetchTemplate(filename);
    }

    const token=getToken();
    if(lastToken!==null && token!==lastToken) clearDataCache();
    lastToken=token;
    const authRoutes={login:"login",requestAccount:"register",getCurrentUser:"session",getSessionInfo:"session-info",getMyPermissions:"permissions",logout:"logout",changeOwnPassword:"password",uploadOwnProfileImage:"profile-image",removeOwnProfileImage:"profile-image/remove"};
    const cacheable=isCacheableRead(method) && token && !authRoutes[method];
    const key=cacheable?stableKey(method,args,token):null;
    if(key){
      const entry=dataCache.get(key);
      if(entry && entry.expiresAt>Date.now()) return entry.value;
      if(entry) dataCache.delete(key);
      if(inflightReads.has(key)) return inflightReads.get(key);
    }
    const requestCacheEpoch = cacheEpoch;
    const route=authRoutes[method]?`/api/auth/${authRoutes[method]}`:`/api/legacy/${encodeURIComponent(method)}`;
    const requestTask=(async()=>{
      const response=await fetch(route,{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({args,token})
      });
      let payload={}; try{payload=await response.json()}catch{}
      if(!response.ok) throw err(payload,response.status);
      return payload;
    })();
    if(key) inflightReads.set(key,requestTask);
    let payload;
    try { payload=await requestTask; }
    finally { if(key && inflightReads.get(key)===requestTask) inflightReads.delete(key); }
    // Any successful write invalidates the shared data cache so subsequent reads
    // reflect changes made by this user. Live/patrol data is never cached above.
    const isRead=/^(get|list|load|systemGet|dashboardGet|fetch)[A-Z_]/.test(method) || ["getCurrentUser","getSessionInfo","getMyPermissions"].includes(method);
    if(!isRead){
      clearDataCache();
      window.dispatchEvent(new CustomEvent("fib-mdt:data-changed", {detail:{method, at:Date.now()}}));
    }
    else if(key && requestCacheEpoch === cacheEpoch){
      const ttl = PREFETCHABLE_SHEET_READS.has(method) ? PREFETCH_DATA_TTL_MS : DATA_TTL_MS;
      dataCache.set(key,{value:payload,expiresAt:Date.now()+ttl});
    }
    if(method==="logout") { clearDataCache(); lastToken=null; }
    return payload;
  }
  function makeRunner(){let success=null,failure=null,used=false;const proxy=new Proxy({}, {get(_t,p){
    if(p==="withSuccessHandler") return fn=>{success=fn;return proxy};
    if(p==="withFailureHandler") return fn=>{failure=fn;return proxy};
    if(p==="then") return undefined;
    return (...args)=>{if(used)throw new Error("Ein API-Runner kann nur einen Aufruf ausführen.");used=true;invoke(String(p),args).then(v=>{if(typeof success==="function")success(v)}).catch(e=>{if(typeof failure==="function")failure(e);else console.error("LSPD MDT API",e)});};
  }});return proxy;}
  const api={};
  Object.defineProperty(api,"run",{get:makeRunner});
  window.CloudApi=api;
  window.runServer=(method,...args)=>invoke(method,args);
  window.FIBMDTCache={
    preloadPages,
    clear:clearDataCache,
    clearPageTemplates:()=>{templateCache.clear();},
    getPageTemplateStatus:()=>({loaded:templateCache.size,total:new Set(Object.values(pages)).size}),
    refresh:async method=>{ if(method){for(const key of dataCache.keys()) if(key.includes(`\u0000${method}\u0000`)) dataCache.delete(key);} else clearDataCache(); }
  };
  // Warm every static page template immediately. First navigation can use this cache.
  preloadPages().catch(error=>console.warn("[LSPD MDT] Vorladen der Seitentemplates fehlgeschlagen:",error));
})();
