(function () {
  "use strict";
  var root = document.getElementById("lspdCalendarPage");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";
  var rows = [], canManage = false, loading=false, editing = { event: null, change: null }, pendingDelete = null, monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
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
  var message = function (value) { $("calMessage").textContent = value; };
  var isChange = function (r) { return r && r.metadata && r.metadata.entry_type === "schedule_change"; };
  var formatDate = function (value) { if (!value) return "Ohne Zeitangabe"; var d = new Date(value); return Number.isNaN(d.getTime()) ? "Ohne Zeitangabe" : d.toLocaleString("de-DE", {dateStyle:"medium",timeStyle:"short"}); };
  var statusLabel = function (value) { return ({planned:"Geplant",confirmed:"Bestätigt",completed:"Abgeschlossen",cancelled:"Abgesagt",active:"Aktiv"})[value] || value || "—"; };
  var rich = function (value) { return window.MDTRichText ? window.MDTRichText.render(value) : "<p>" + esc(value).replace(/\n/g,"<br>") + "</p>"; };

  function sorted(list) {
    return list.slice().sort(function (a,b) {
      var ad = Date.parse(a.eventDate || a.created_at || 0) || 0, bd = Date.parse(b.eventDate || b.created_at || 0) || 0;
      if (!ad && !bd) return String(b.created_at||"").localeCompare(String(a.created_at||""));
      if (!ad) return 1; if (!bd) return -1; return ad - bd;
    });
  }
  function card(row, type) {
    var id=esc(row.id),vac=row.metadata?.entry_type==="vacation",date=vac&&row.metadata.start_date&&row.metadata.end_date?row.metadata.start_date.split("-").reverse().join(".")+" – "+row.metadata.end_date.split("-").reverse().join("."):formatDate(row.event_date),label=vac?"Genehmigt":statusLabel(row.status);
    return '<article class="lspd-module-entry" data-entry="' + id + '">' +
      '<div class="lspd-module-entry-top"><div><h4>' + esc(row.title || "Ohne Titel") + '</h4><div class="lspd-module-meta"><span>' + esc(date) + '</span><span class="lspd-module-tag ' + (type === "change" ? "gold" : "") + '">' + esc(label) + '</span>' + (vac?'':'<span>Erstellt von ' + esc(row.created_by_name || "Unbekannt") + '</span>') + '</div></div>' +
      (canManage&&!vac ? '<div class="lspd-module-entry-actions"><button class="lspd-btn subtle" data-edit="' + id + '" data-type="' + type + '">Bearbeiten</button><button class="lspd-btn danger" data-delete="' + id + '" data-type="' + type + '">Löschen</button></div>' : '') + '</div>' +
      '<div class="lspd-module-entry-body mdt-rich-content">' + rich(row.description || "") + '</div>' +
      '<div class="lspd-confirm" data-confirm="' + id + '"><span>Eintrag wirklich löschen?</span><button class="lspd-btn danger" data-confirm-yes="' + id + '" data-type="' + type + '">Ja, löschen</button><button class="lspd-btn" data-confirm-no="' + id + '">Abbrechen</button></div></article>';
  }
  function dateKey(date) { return date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0"); }
  function renderMonth(events) {
    var year = monthCursor.getFullYear(), month = monthCursor.getMonth();
    $("calMonthTitle").textContent = monthCursor.toLocaleDateString("de-DE",{month:"long",year:"numeric"});
    var first = new Date(year,month,1), offset = (first.getDay()+6)%7, start = new Date(year,month,1-offset);
    var weekdays = ["Mo","Di","Mi","Do","Fr","Sa","So"];
    var html = weekdays.map(function(day){return '<div class="lspd-calendar-weekday">'+day+'</div>';}).join("");
    var today = dateKey(new Date()), dated = {};
    const gridEnd=new Date(start.getFullYear(),start.getMonth(),start.getDate()+41);
    events.forEach(function(r){var m=r.metadata||{};if(m.entry_type==="vacation"&&m.start_date&&m.end_date){var a=new Date(m.start_date+"T00:00:00"),b=new Date(m.end_date+"T00:00:00");if(!Number.isNaN(a.getTime())&&!Number.isNaN(b.getTime())){for(var d=new Date(Math.max(+a,+start));d<=b&&d<=gridEnd;d.setDate(d.getDate()+1)){var key=dateKey(d);(dated[key]||(dated[key]=[])).push(r);}return;}}if(!r.event_date)return;var d=new Date(r.event_date);if(Number.isNaN(d.getTime()))return;var key=dateKey(d);(dated[key]||(dated[key]=[])).push(r);});
    for(var n=0;n<42;n++){
      var day = new Date(start.getFullYear(),start.getMonth(),start.getDate()+n), key=dateKey(day), items=dated[key]||[];
      html += '<div class="lspd-calendar-day '+(day.getMonth()!==month?'is-outside ':'')+(key===today?'is-today':'')+'"><div class="lspd-calendar-day-number">'+day.getDate()+'</div>'+
        items.map(function(r){return '<span class="lspd-calendar-event'+((r.metadata&&r.metadata.entry_type==="vacation")?" lspd-calendar-vacation":"")+'" title="'+esc(r.title||"Termin")+'">'+esc(r.title||"Termin")+'</span>';}).join("")+
        '</div>';
    }
    $("calMonthGrid").innerHTML=html;
  }
  function render() {
    var events = sorted(rows.filter(function (r) { return !isChange(r); }));
    renderMonth(events);
    var changes = sorted(rows.filter(isChange));
    $("calEventCount").textContent = events.length + (events.length === 1 ? " Termin" : " Termine");
    $("calChangeCount").textContent = changes.length + (changes.length === 1 ? " Änderung" : " Änderungen");
    $("calEvents").innerHTML = events.length ? events.map(function (r) { return card(r,"event"); }).join("") : '<div class="lspd-module-empty">Derzeit sind keine Termine eingetragen.</div>';
    $("calChanges").innerHTML = changes.length ? changes.map(function (r) { return card(r,"change"); }).join("") : '<div class="lspd-module-empty">Derzeit sind keine Dienstplanänderungen eingetragen.</div>';
  }
  async function load() {
    if(loading)return;loading=true;
    try {
      var [permissionState,result]=await Promise.all([call("getMyPermissions"),call("getModuleItems","calendar")]);if(!root.isConnected)return;
      var permissionList = permissionState && Array.isArray(permissionState.permissions) ? permissionState.permissions : [];
      const allowed=key=>!!permissionState?.master||((permissionList.includes("*")||permissionList.includes(key))&&(!(permissionState.departmentScopedPermissions||[]).includes(key)||(permissionState.departmentPermissions||[]).includes(key)));canManage=allowed("calendar.view")&&allowed("calendar.manage");
      $("calNewEvent").hidden = !canManage;
      $("calNewChange").hidden = !canManage;
      
      rows = Array.isArray(result) ? result : [];
      message(rows.length + " Kalendereinträge geladen.");
      render();
    } catch (error) {
      message(error && error.message ? error.message : "Kalenderdaten konnten nicht geladen werden.");
      $("calEvents").innerHTML = '<div class="lspd-module-empty">Der Kalender ist derzeit nicht erreichbar. Bitte Berechtigungen und Verbindung prüfen.</div>';
      $("calChanges").innerHTML = "";
    }finally{loading=false;}
  }
  function toLocal(value) {
    if (!value) return "";
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  function openEditor(type, row) {
    if (!canManage||row?.metadata?.entry_type==="vacation") return;
    editing[type] = row ? row.id : null;
    var prefix = type === "event" ? "calEvent" : "calChange";
    var panel = type === "event" ? $("calEventEditor") : $("calChangeEditor");
    panel.classList.add("is-open");
    $(prefix+"Title").value = row ? row.title || "" : "";
    $(prefix+"Description").value = row ? row.description || "" : "";
    $(prefix+"Status").value = row ? row.status || (type === "event" ? "planned" : "active") : (type === "event" ? "planned" : "active");
    $(prefix+"Date").value = row ? toLocal(row.event_date) : "";
    $(prefix+"Title").focus();
  }
  function closeEditor(type) {
    var prefix = type === "event" ? "calEvent" : "calChange";
    (type === "event" ? $("calEventEditor") : $("calChangeEditor")).classList.remove("is-open");
    editing[type] = null;
    ["Title","Description","Date"].forEach(function (field) { $(prefix+field).value = ""; });
    $(prefix+"Status").selectedIndex = 0;
  }
  async function save(type) {
    var prefix = type === "event" ? "calEvent" : "calChange";
    var title = $(prefix+"Title").value.trim();
    if (!title) { message("Bitte einen Titel eingeben."); $(prefix+"Title").focus(); return; }
    var old = rows.find(function (r) { return String(r.id) === String(editing[type]); });
    var data = {
      title: title,
      description: $(prefix+"Description").value.trim(),
      status: $(prefix+"Status").value,
      eventDate: $(prefix+"Date").value ? new Date($(prefix+"Date").value).toISOString() : null,
      metadata: Object.assign({}, old && old.metadata || {}, { application: "lspd", entry_type: type === "event" ? "event" : "schedule_change" })
    };
    var button = $(prefix+"Save"); button.disabled = true;
    try {
      if (editing[type]) await call("updateModuleItem","calendar",editing[type],data);
      else await call("createModuleItem","calendar",data);
      closeEditor(type); message(type === "event" ? "Termin gespeichert." : "Dienstplanänderung gespeichert."); await load();
    } catch (error) { message(error && error.message ? error.message : "Speichern fehlgeschlagen."); }
    finally { button.disabled = false; }
  }

  $("calNewEvent").addEventListener("click",function(){openEditor("event");});
  $("calNewChange").addEventListener("click",function(){openEditor("change");});
  $("calEventSave").addEventListener("click",function(){save("event");});
  $("calChangeSave").addEventListener("click",function(){save("change");});
  $("calEventCancel").addEventListener("click",function(){closeEditor("event");});
  $("calChangeCancel").addEventListener("click",function(){closeEditor("change");});
  $("calReload").addEventListener("click",load);
  $("calMonthPrev").addEventListener("click",function(){monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()-1,1);render();});
  $("calMonthNext").addEventListener("click",function(){monthCursor=new Date(monthCursor.getFullYear(),monthCursor.getMonth()+1,1);render();});
  $("calMonthToday").addEventListener("click",function(){monthCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);render();});
  root.addEventListener("click",async function(event){
    var edit=event.target.closest("[data-edit]"), del=event.target.closest("[data-delete]"), yes=event.target.closest("[data-confirm-yes]"), no=event.target.closest("[data-confirm-no]");
    if(edit){var row=rows.find(function(r){return String(r.id)===edit.dataset.edit;});if(row)openEditor(edit.dataset.type,row);return;}
    if(del){var box=del.closest(".lspd-module-entry").querySelector(".lspd-confirm");box.classList.add("is-open");return;}
    if(no){var n=no.closest(".lspd-confirm");if(n)n.classList.remove("is-open");return;}
    if(yes){yes.disabled=true;try{await call("deleteModuleItem","calendar",yes.dataset.confirmYes);message("Eintrag gelöscht.");await load();}catch(error){message(error&&error.message?error.message:"Löschen fehlgeschlagen.");}finally{yes.disabled=false;}}
  });
  window.__fibPageLifecycle.on(window,"fib-mdt:refresh-request",function(){if(root.isConnected&&!$("calEventEditor").classList.contains("is-open")&&!$("calChangeEditor").classList.contains("is-open"))load();});
  window.__fibPageLifecycle.on(window,"fib-mdt:data-changed",function(e){if(root.isConnected&&/VacationRequest|ModuleItem/.test(e.detail?.method||"")&&!$("calEventEditor").classList.contains("is-open")&&!$("calChangeEditor").classList.contains("is-open"))load();});
  load();
})();
