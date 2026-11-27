(function () {
  "use strict";
  var root = document.getElementById("lspdAnnouncementsPage");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";
  var rows = [], canManage = false, editing = null, loading=false, saving=false;
  var $ = function (id) { return root.querySelector('#'+id); };
  var token = function () { return sessionStorage.getItem("fib_mdt_session") || sessionStorage.getItem("lspd_mdt_session") || ""; };
  var call = function (method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var runner = CloudApi.run;
      runner.withSuccessHandler(resolve).withFailureHandler(reject)[method](token(), ...args);
    });
  };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]; }); };
  var renderRich = function (value) { return window.MDTRichText ? window.MDTRichText.render(value) : "<p>" + esc(value).replace(/\n/g,"<br>") + "</p>"; };
  var message = function (value) { $("annMessage").textContent = value; };
  var date = function (value) { if (!value) return "Ohne Zeitangabe"; var d = new Date(value); return Number.isNaN(d.getTime()) ? "Ohne Zeitangabe" : d.toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"}); };
  if (window.MDTRichText) window.MDTRichText.attachToolbar(root);

  function render() {
    var q=$("annSearch").value.trim().toLowerCase(),f=$("annFilter").value;
    var important=r=>r.metadata?.priority==="important";
    var visible=rows.filter(r=>(!q||[r.title,r.description,r.created_by_name].join(" ").toLowerCase().includes(q))&&(!f||(f==="important"?important(r):r.status===f))).sort((a,b)=>Number(important(b)&&b.status==="active")-Number(important(a)&&a.status==="active")||String(b.created_at||"").localeCompare(String(a.created_at||"")));
    $("annCount").textContent=visible.length+(visible.length===1?" Mitteilung":" Mitteilungen");
    $("annList").innerHTML = visible.length ? visible.map(function (r) {
      var important = r.metadata && r.metadata.priority === "important";
      var status = ({active:"Veröffentlicht",draft:"Entwurf",archived:"Archiviert"})[r.status] || r.status || "—";
      return '<article class="lspd-announcement-card ' + (important ? "is-important" : "") + '" data-ann-id="' + esc(r.id) + '">' +
        '<div class="lspd-announcement-top"><div><h3 class="lspd-announcement-title">' + esc(r.title || "Ohne Titel") + '</h3><div class="lspd-announcement-meta"><span>' + esc(date(r.eventDate || r.created_at)) + '</span><span class="lspd-announcement-tag">' + esc(status) + '</span>' + (important ? '<span class="lspd-announcement-tag important">Wichtige Mitteilung</span>' : '') + '<span>Veröffentlicht von ' + esc(r.created_by_name || "Unbekannt") + '</span></div></div>' +
        (canManage ? '<div class="lspd-announcement-actions"><button class="lspd-btn subtle" data-ann-edit="' + esc(r.id) + '">Bearbeiten</button><button class="lspd-btn danger" data-ann-delete="' + esc(r.id) + '">Löschen</button></div>' : '') + '</div>' +
        '<div class="lspd-announcement-body mdt-rich-content">' + renderRich(r.description || "") + '</div>' +
        '<div class="lspd-confirm" data-ann-confirm="' + esc(r.id) + '"><span>Bekanntmachung wirklich löschen?</span><button class="lspd-btn danger" data-ann-confirm-yes="' + esc(r.id) + '">Ja, löschen</button><button class="lspd-btn" data-ann-confirm-no="' + esc(r.id) + '">Abbrechen</button></div></article>';
    }).join("") : '<div class="lspd-announcement-empty">Es sind noch keine Bekanntmachungen vorhanden.</div>';
  }
  async function load() {
    if(loading)return;loading=true;
    try {
      var [permissionState,result] = await Promise.all([call("getMyPermissions"),call("getModuleItems","announcements")]);if(!root.isConnected)return;
      var permissionList = permissionState && Array.isArray(permissionState.permissions) ? permissionState.permissions : [];
      canManage = !!permissionState?.master || ((permissionList.includes("*")||permissionList.includes("announcements.manage"))&&(!(permissionState.departmentScopedPermissions||[]).includes("announcements.manage")||(permissionState.departmentPermissions||[]).includes("announcements.manage")));
      $("annNew").hidden = !canManage;
      for(const o of $("annFilter").options){if(["draft","archived"].includes(o.value))o.hidden=!canManage,o.disabled=!canManage;}if(!canManage&&["draft","archived"].includes($("annFilter").value))$("annFilter").value="";if(!canManage)close();
      rows = Array.isArray(result) ? result : [];
      message(rows.length + " Bekanntmachungen geladen.");
      render();
    } catch (error) {
      message(error && error.message ? error.message : "Bekanntmachungen konnten nicht geladen werden.");
      $("annList").innerHTML = '<div class="lspd-announcement-empty">Die Bekanntmachungen sind derzeit nicht erreichbar. Bitte Berechtigungen und Verbindung prüfen.</div>';canManage=false;$("annNew").hidden=true;close();
    }finally{loading=false;}
  }
  function localDate(value) {
    if (!value) return "";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  function open(row) {
    if (!canManage) return;
    editing = row ? row.id : null;
    $("annEditor").classList.add("is-open");
    $("annTitle").value = row ? row.title || "" : "";
    $("annDescription").value = row ? row.description || "" : "";
    $("annStatus").value = row ? row.status || "active" : "active";
    $("annPriority").value = row && row.metadata && row.metadata.priority === "important" ? "important" : "normal";
    $("annDate").value = row ? localDate(row.eventDate) : "";
    preview();
    $("annTitle").focus();
  }
  function close() {
    $("annEditor").classList.remove("is-open");
    editing = null;
    $("annTitle").value = ""; $("annDescription").value = ""; $("annDate").value = "";
    $("annStatus").value = "active"; $("annPriority").value = "normal";
    preview();
  }
  function preview() {
    $("annPreview").innerHTML = renderRich($("annDescription").value || "");
  }
  async function save() {
    if(saving||!canManage)return;
    var title = $("annTitle").value.trim();
    if (!title) { message("Bitte eine Überschrift eingeben."); $("annTitle").focus(); return; }
    var old = rows.find(function(r){return String(r.id)===String(editing);});
    var data = {
      title: title,
      description: $("annDescription").value,
      status: $("annStatus").value,
      eventDate: $("annDate").value ? new Date($("annDate").value).toISOString() : null,
      metadata: Object.assign({}, old && old.metadata || {}, { application:"lspd", entry_type:"department_announcement", priority:$("annPriority").value })
    };
    saving=true;$("annSave").disabled = true;
    try {
      if (editing) await call("updateModuleItem","announcements",editing,data);
      else await call("createModuleItem","announcements",data);
      close(); message("Bekanntmachung gespeichert."); await load();
    } catch (error) { message(error && error.message ? error.message : "Speichern fehlgeschlagen."); }
    finally { saving=false;$("annSave").disabled = false; }
  }
  $("annNew").addEventListener("click",function(){open();});
  $("annCancel").addEventListener("click",close);
  $("annSave").addEventListener("click",save);
  $("annReload").addEventListener("click",load);$("annSearch").addEventListener("input",render);$("annFilter").addEventListener("change",render);
  $("annDescription").addEventListener("input",preview);
  root.addEventListener("click",async function(event){
    var edit=event.target.closest("[data-ann-edit]"), del=event.target.closest("[data-ann-delete]"), yes=event.target.closest("[data-ann-confirm-yes]"), no=event.target.closest("[data-ann-confirm-no]");
    if(edit){var row=rows.find(function(r){return String(r.id)===edit.dataset.annEdit;});if(row)open(row);return;}
    if(del){del.closest(".lspd-announcement-card").querySelector(".lspd-confirm").classList.add("is-open");return;}
    if(no){no.closest(".lspd-confirm").classList.remove("is-open");return;}
    if(yes){yes.disabled=true;try{await call("deleteModuleItem","announcements",yes.dataset.annConfirmYes);message("Bekanntmachung gelöscht.");await load();}catch(error){message(error&&error.message?error.message:"Löschen fehlgeschlagen.");}finally{yes.disabled=false;}}
  });
  window.__fibPageLifecycle.on(window,"fib-mdt:refresh-request",function(){if(root.isConnected&&!saving&&!$("annEditor").classList.contains("is-open"))load();});
  window.__fibPageLifecycle.on(window,"fib-mdt:data-changed",function(e){if(root.isConnected&&!saving&&!$("annEditor").classList.contains("is-open")&&/ModuleItem/.test(e.detail?.method||""))load();});
  load();
})();
