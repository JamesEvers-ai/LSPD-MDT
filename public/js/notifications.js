(() => {
  if (window.FIB_MDT_NOTIFICATIONS) return;
  const notify=(type,title,message="")=>{
    const text=[title,message].filter(Boolean).join(" — ");
    if (typeof window.showNotification === "function") return window.showNotification(type,text);
    console.log(`[LSPD MDT ${String(type||"info").toUpperCase()}]`,text);
  };
  window.FIB_MDT_NOTIFICATIONS={show:notify,success:(t,m)=>notify("success",t,m),error:(t,m)=>notify("error",t,m),info:(t,m)=>notify("info",t,m)};
})();
