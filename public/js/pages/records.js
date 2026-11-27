(function () {
  "use strict";

  const previous = window.__FIB_MDT_RECORDS__;

  if (previous && typeof previous.cleanup === "function") {
    try { previous.cleanup(); } catch (error) {}
  }

  const TYPES = {
    investigation: {
      label: "Ermittlungsakten",
      shortLabel: "Ermittlungsakte",
      description: "Laufende und abgeschlossene Ermittlungsverfahren.",
      classification: "Intern",
      view: "records.investigations.view",
      create: "records.investigations.create",
      edit: "records.investigations.edit",
      secure: false,
      icon: "fa-folder-open"
    },
    report: {
      label: "Berichte",
      shortLabel: "Bericht",
      description: "Dienstliche Berichte und dokumentierte Vorgänge.",
      classification: "Intern",
      view: "records.reports.view",
      create: "records.reports.create",
      edit: "records.reports.edit",
      secure: false,
      icon: "fa-file-lines"
    },
    ia: {
      label: "IA-Akten",
      shortLabel: "IA-Akte",
      description: "Besonders geschützte Akten der Internal Affairs Division.",
      classification: "Geschützt – Internal Affairs",
      view: "records.ia.view",
      create: "records.ia.create",
      edit: "records.ia.edit",
      secure: true,
      icon: "fa-shield-halved"
    },
    highcommand: {
      label: "High Command Akten",
      shortLabel: "High Command Akte",
      description: "Besonders geschützte Akten des High Command.",
      classification: "Streng vertraulich – High Command",
      view: "records.highcommand.view",
      create: "records.highcommand.create",
      edit: "records.highcommand.edit",
      secure: true,
      icon: "fa-user-shield"
    }
  };

  const STATUSES = {
    open: { label: "Offen", className: "active" },
    in_progress: { label: "In Bearbeitung", className: "progress" },
    closed: { label: "Abgeschlossen", className: "closed" },
    archived: { label: "Archiviert", className: "inactive" }
  };

  const TAB_ORDER = ["investigation", "report", "ia", "highcommand", "archive"];
  const CACHE_TTL = 12000;
  const PAGE_SIZE = 50;
  const root = document.getElementById("fibRecordsPage");
  if (!root) return;
  const life = window.__fibPageLifecycle;

  const state = {
    initialized: false,
    currentTab: "investigation",
    currentStatus: "all",
    search: "",
    page: 0,
    hasNext: false,
    pendingKey: null,
    modalRequestId: 0,
    alive: true,
    records: [],
    recordCache: new Map(),
    requestId: 0,
    searchTimer: null,
    busy: false,
    modalMode: null,
    currentRecord: null,
    modalType: null,
    eventsBound: false
  };

  window.__FIB_MDT_RECORDS__ = state;

  function token() {
    try {
      if (typeof sessionToken !== "undefined" && sessionToken) return sessionToken;
    } catch (error) {}

    try {
      if (window.sessionToken) return window.sessionToken;
    } catch (error) {}

    try {
      return sessionStorage.getItem("fib_mdt_session") ||
        sessionStorage.getItem("lspd_mdt_session") || "";
    } catch (error) {
      return "";
    }
  }

  function isMasterAccount() {
    try {
      if (typeof isMaster !== "undefined" && isMaster === true) return true;
    } catch (error) {}
    return window.isMaster === true;
  }

  function can(permission) {
    if (!permission) return false;
    if (isMasterAccount()) return true;

    try {
      if (typeof hasPermission === "function") return hasPermission(permission);
    } catch (error) {}

    try {
      if (Array.isArray(myPermissions)) return myPermissions.includes(permission);
    } catch (error) {}

    return false;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Separate helper for values inserted into HTML attributes.
  // Keep it alongside escapeHtml so every records-page renderer can use it.
  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function formatRecordText(value) {
    const lines = escapeHtml(value || "").split(/\r?\n/);
    let html = "", inList = false;
    lines.forEach(function(line) {
      if (/^\s*-\s+/.test(line)) {
        if (!inList) { html += "<ul>"; inList = true; }
        line = line.replace(/^\s*-\s+/, "");
        line = line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
        html += "<li>" + line + "</li>";
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        line = line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
        html += line ? "<p>" + line + "</p>" : "";
      }
    });
    if (inList) html += "</ul>";
    return html;
  }

  function notifyRecords(type, title, message) {
    try {
      if (typeof notify === "function") {
        notify(type, title, message);
        return;
      }
    } catch (error) {}

    if (type === "error") {
      window.alert(message || title || "Fehler");
    }
  }

  function getType(typeId) {
    return TYPES[String(typeId || "").toLowerCase()] || null;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getVisibleTabs() {
    const result = [];
    if (!can("records.view")) return result;

    Object.keys(TYPES).forEach(function (typeId) {
      if (can(TYPES[typeId].view)) result.push(typeId);
    });

    if (isMasterAccount() || result.length) result.push("archive");
    return result;
  }

  function getCurrentTypeConfig() {
    return getType(state.currentTab);
  }

  function getCreatableTypes() {
    return Object.keys(TYPES).filter(function (typeId) {
      return can(TYPES[typeId].view) && can(TYPES[typeId].create);
    });
  }

  function buildTabs() {
    const container = document.getElementById("recordsTabs");
    if (!container) return;

    const visible = getVisibleTabs();

    if (!visible.length) {
      container.innerHTML = "";
      renderEmpty(
        "Keine Aktenberechtigung",
        "Für deinen Account wurde keine berechtigte Aktenart gefunden."
      );
      return;
    }

    if (!visible.includes(state.currentTab)) {
      state.currentTab = visible[0];
    }

    container.innerHTML = visible.map(function (tabId) {
      if (tabId === "archive") {
        return `
          <button type="button" class="records-tab ${state.currentTab === "archive" ? "active" : ""}"
            onclick="recordsOpenTab('archive')">
            <i class="fa-solid fa-box-archive"></i>
            Archiv
          </button>
        `;
      }

      const type = TYPES[tabId];
      return `
        <button type="button" class="records-tab ${state.currentTab === tabId ? "active" : ""}"
          onclick="recordsOpenTab('${escapeAttr(tabId)}')">
          <i class="fa-solid ${escapeAttr(type.icon)}"></i>
          ${escapeHtml(type.label)}
          ${type.secure ? '<span class="records-tab-secure"><i class="fa-solid fa-lock"></i></span>' : ''}
        </button>
      `;
    }).join("");
  }

  function updateToolbar() {
    const title = document.getElementById("recordsToolbarTitle");
    const description = document.getElementById("recordsToolbarDescription");
    const status = document.getElementById("recordsStatus");

    if (state.currentTab === "archive") {
      if (title) title.textContent = "Archiv";
      if (description) description.textContent = "Archivierte Akten aus allen für deinen Account freigegebenen Bereichen.";
      if (status) {
        status.innerHTML = '<option value="archived">Archiviert</option>';
        status.value = "archived";
        status.disabled = true;
      }
      return;
    }

    const type = getCurrentTypeConfig();
    if (title) title.textContent = type?.label || "Akten";
    if (description) description.textContent = type?.description || "Aktenbereich";

    if (status) {
      status.disabled = false;
      status.innerHTML =
        '<option value="all">Alle aktiven Status</option>' +
        '<option value="open">Offen</option>' +
        '<option value="in_progress">In Bearbeitung</option>' +
        '<option value="closed">Abgeschlossen</option>';
      status.value = state.currentStatus === "archived" ? "all" : state.currentStatus;
    }
  }

  function updateCreateButton() {
    const button = document.getElementById("recordsCreateButton");
    const label = document.getElementById("recordsCreateButtonLabel");
    if (!button) return;

    if (state.currentTab === "archive") {
      button.style.display = "none";
      return;
    }

    const type = getCurrentTypeConfig();
    const allowed = !!type && can(type.create);

    button.style.display = allowed ? "inline-flex" : "none";
    if (label) {
      label.textContent = type ? "+ " + type.shortLabel : "Neue Akte";
    }
  }

  function cacheKey() {
    return JSON.stringify([state.currentTab, state.currentStatus, state.search, state.page, getVisibleTabs()]);
  }

  function renderLoading() {
    const body = document.getElementById("recordsTableBody");
    if (!body) return;

    body.innerHTML = `
      <tr class="records-loading-row">
        <td colspan="6">
          <div class="records-loading">
            <span class="records-spinner"></span>
            Akten werden geladen...
          </div>
        </td>
      </tr>
    `;
  }

  function renderEmpty(title, text) {
    const body = document.getElementById("recordsTableBody");
    if (!body) return;

    body.innerHTML = `
      <tr>
        <td colspan="6" class="records-empty">
          <div class="records-empty-icon">
            <i class="fa-solid fa-folder-open"></i>
          </div>
          <div class="records-empty-title">${escapeHtml(title || "Keine Einträge")}</div>
          <div class="records-empty-text">${escapeHtml(text || "Es wurden keine passenden Einträge gefunden.")}</div>
        </td>
      </tr>
    `;
  }

  function updatePager(loading=false) {
    const count=document.getElementById("recordsResultCount"),prev=document.getElementById("recordsPrevPage"),next=document.getElementById("recordsNextPage");
    if(count)count.textContent=loading?"Akten werden geladen …":state.records.length?`${state.page*PAGE_SIZE+1}–${state.page*PAGE_SIZE+state.records.length} · Seite ${state.page+1}`:"Keine Einträge";
    if(prev)prev.disabled=loading||state.page===0;
    if(next)next.disabled=loading||!state.hasNext;
  }
  function renderRecords(records) {
    const body = document.getElementById("recordsTableBody");
    if (!body) return;

    updatePager();
    if (!Array.isArray(records) || !records.length) {
      renderEmpty(
        "Keine Einträge gefunden",
        state.currentTab === "archive"
          ? "Das Archiv enthält in den für deinen Account freigegebenen Bereichen derzeit keine Akten."
          : "Für die aktuelle Auswahl wurden keine Akten gefunden."
      );
      return;
    }

    body.innerHTML = records.map(function (record) {
      const type = getType(record.type) || {
        label: record.type || "Unbekannt",
        shortLabel: record.type || "Unbekannt",
        classification: record.classification || "—",
        edit: ""
      };

      const status = STATUSES[record.status] || {
        label: record.status || "Unbekannt",
        className: "inactive"
      };

      const editable = can(type.edit) && record.status !== "archived";
      const secureClass = record.type === "highcommand" ? "director" : record.type === "ia" ? "doc" : "";
      return `<tr>
          <td><span class="records-case-number">${escapeHtml(record.case_number || record.caseNumber || "—")}</span></td>
          <td class="records-title-cell"><button type="button" class="records-title-link" data-record-open="${escapeAttr(record.id)}">${escapeHtml(record.title || "—")}</button>${record.subject?`<div class="records-secondary records-subject">${escapeHtml(record.subject)}</div>`:""}${record.summary?`<div class="records-secondary records-summary">${escapeHtml(record.summary)}</div>`:""}</td>
          <td><span class="records-type-badge">${escapeHtml(type.shortLabel || type.label)}</span><div class="records-secondary records-classification ${secureClass}">${escapeHtml(record.classification || type.classification || "—")}</div></td>
          <td><span class="records-status-badge ${escapeAttr(status.className)}">${escapeHtml(status.label)}</span></td>
          <td><div class="records-updated">${escapeHtml(formatDate(record.updated_at || record.updatedAt))}</div><div class="records-secondary">${escapeHtml(record.updated_by_name||record.created_by_name||"")}</div></td>
          <td><div class="records-actions"><button type="button" class="records-button small" data-record-open="${escapeAttr(record.id)}">Öffnen</button>${editable?`<button type="button" class="records-button small" data-record-edit="${escapeAttr(record.id)}">Bearbeiten</button>`:""}</div></td>
        </tr>`;
    }).join("");
  }

  function loadCurrent(force=false,background=false) {
    if(!state.alive||!root.isConnected)return;
    const currentToken=token();
    if(!currentToken||!getVisibleTabs().includes(state.currentTab)){state.requestId++;state.pendingKey=null;state.records=[];state.hasNext=false;updatePager();renderEmpty("Kein Zugriff","Für diesen Aktenbereich fehlt die erforderliche Berechtigung.");return;}
    const key=cacheKey();
    if(state.pendingKey===key&&!force)return;
    const requestId=++state.requestId;
    const cached=state.recordCache.get(key);
    if(!force&&cached&&Date.now()-cached.timestamp<CACHE_TTL){state.pendingKey=null;state.records=cached.records;state.hasNext=cached.hasNext;renderRecords(state.records);return;}
    state.pendingKey=key;
    const requestedPage=state.page;
    if(!background){state.records=[];state.hasNext=false;renderLoading();updatePager(true);}
    window.runServer("getRecords",currentToken,state.currentTab,state.currentStatus,state.search,PAGE_SIZE+1,requestedPage*PAGE_SIZE).then(rows=>{
      if(!state.alive||!root.isConnected||requestId!==state.requestId||key!==cacheKey())return;
      state.pendingKey=null;
      const records=Array.isArray(rows)?rows:[];
      if(!records.length&&state.page>0){state.page--;loadCurrent(true);return;}
      state.hasNext=records.length>PAGE_SIZE;state.records=records.slice(0,PAGE_SIZE);
      if(state.recordCache.size>=24)state.recordCache.delete(state.recordCache.keys().next().value);
      state.recordCache.set(key,{timestamp:Date.now(),records:state.records,hasNext:state.hasNext});
      renderRecords(state.records);
    }).catch(error=>{
      if(!state.alive||!root.isConnected||requestId!==state.requestId)return;
      state.pendingKey=null;state.records=[];state.hasNext=false;updatePager();renderEmpty("Akten konnten nicht geladen werden",error?.message||"Die Abfrage ist fehlgeschlagen.");
    });
  }
  function changePage(delta){if(state.pendingKey)return;const next=state.page+delta;if(next<0||delta>0&&!state.hasNext)return;state.page=next;loadCurrent(false);}

  function invalidateCache() {
    state.recordCache.clear();
  }

  function openTab(tabId) {
    if (!TAB_ORDER.includes(tabId)) return;
    if (tabId !== "archive" && !can(TYPES[tabId]?.view)) {
      notifyRecords("error", "Kein Zugriff", "Du besitzt keine Berechtigung für diesen Aktenbereich.");
      return;
    }

    state.currentTab = tabId;
    state.page = 0;
    if(state.searchTimer)clearTimeout(state.searchTimer);
    state.currentStatus = tabId === "archive" ? "archived" : "all";
    buildTabs();
    updateToolbar();
    updateCreateButton();
    window.FIB_MDT_SELECTS?.refresh?.();
    loadCurrent(false);
  }

  function statusChanged(value) {
    state.currentStatus = String(value || "all");
    state.page = 0;
    loadCurrent(false);
  }

  function searchChanged(value) {
    state.search = String(value || "").trim().slice(0, 100);
    state.page = 0;
    state.requestId++;state.pendingKey=null;state.records=[];state.hasNext=false;updatePager(true);renderLoading();

    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = life.timeout(function () {
      loadCurrent(false);
    }, 260);
  }

  function getGlobalModal() {
    return window.FIB_MDT_MODAL || null;
  }

  function openModal(title, subtitle, bodyHtml, showSave, saveText) {
    const modal = getGlobalModal();
    if (!modal) {
      notifyRecords("error", "Modal nicht verfügbar", "Das globale MDT-Modal konnte nicht initialisiert werden.");
      return;
    }

    state.busy = false;

    modal.open({
      title: title || "Akte",
      subtitle: subtitle || "",
      body: bodyHtml || "",
      saveVisible: !!showSave,
      saveText: saveText || "Speichern",
      onSave: saveModal,
      modalClass: "records",
      focus: false
    });
  }

  function openModalLoading(title, subtitle, message) {
    const modal = getGlobalModal();
    if (!modal) return;

    state.busy = false;
    const requestId=++state.modalRequestId;
    modal.open({
      title: title || "Akte",
      subtitle: subtitle || "",
      body: `
        <div class="records-loading-modal" data-record-request="${requestId}">
          <span class="records-spinner"></span>
          <span>${escapeHtml(message || "Akte wird geladen...")}</span>
        </div>
      `,
      saveVisible: false,
      modalClass: "records",
      focus: false
    });
    return requestId;
  }
  function modalRequestValid(id){return state.alive&&root.isConnected&&state.modalRequestId===id&&!!document.querySelector(`#fibGlobalModalBody [data-record-request="${id}"]`);}

  function closeModal() {
    state.modalRequestId++;
    const modal = getGlobalModal();
    if (modal) modal.close();
    state.modalMode = null;
    state.currentRecord = null;
    state.modalType = null;
    state.busy = false;
  }

  function setBusy(busy, label) {
    state.busy = !!busy;
    const save = getGlobalModal()?.getSaveButton();
    if (!save) return;
    save.disabled = !!busy;
    save.textContent = busy ? (label || "Speichern...") : "Speichern";
  }

  function securityPanel(type) {
    const secure = !!type.secure;
    return `
      <div class="records-security-panel ${secure ? "secure" : ""}">
        <div class="records-security-panel-title">
          <i class="fa-solid ${escapeAttr(type.icon)}"></i>
          ${escapeHtml(type.label)} · ${escapeHtml(type.classification)}
        </div>
        <div class="records-security-panel-text">
          ${escapeHtml(type.description)}
        </div>
      </div>
    `;
  }

  function statusOptions(selected) {
    return [
      ["open", "Offen"],
      ["in_progress", "In Bearbeitung"],
      ["closed", "Abgeschlossen"]
    ].map(function (entry) {
      return `<option value="${entry[0]}" ${String(selected || "open") === entry[0] ? "selected" : ""}>${entry[1]}</option>`;
    }).join("");
  }

  function createForm(defaultTypeId) {
    const types = getCreatableTypes();
    if (!types.length) return "";

    const typeId = types.includes(defaultTypeId) ? defaultTypeId : types[0];
    const type = TYPES[typeId];

    return `
      <div class="records-form-grid">
        <div class="records-form-group">
          <label class="records-form-label">Aktenzeichen</label>
          <input class="records-form-input" type="text" readonly value="Wird automatisch vergeben">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Aktenart</label>
          <select id="recordType" class="records-form-select" onchange="recordsPreviewType(this.value)">
            ${types.map(function (id) {
              return `<option value="${escapeAttr(id)}" ${id === typeId ? "selected" : ""}>${escapeHtml(TYPES[id].shortLabel)}</option>`;
            }).join("")}
          </select>
        </div>

        <div class="records-form-group full">
          <div id="recordSecurityPreview">${securityPanel(type)}</div>
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Titel</label>
          <input id="recordTitle" class="records-form-input" maxlength="160" placeholder="Bezeichnung des Vorgangs">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Betreff</label>
          <input id="recordSubject" class="records-form-input" maxlength="160" placeholder="Person, Organisation oder Vorgang">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Status</label>
          <select id="recordStatus" class="records-form-select">${statusOptions("open")}</select>
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Kurzfassung</label>
          <input id="recordSummary" class="records-form-input" maxlength="500" placeholder="Kurze Zusammenfassung für die Listenansicht">
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Akteninhalt</label>
          <div class="records-rich-toolbar" aria-label="Textformatierung">
            <button type="button" data-mdt-format="bold" data-target="recordContent" title="Fett"><strong>B</strong></button>
            <button type="button" data-mdt-format="italic" data-target="recordContent" title="Kursiv"><em>I</em></button>
            <button type="button" data-mdt-format="underline" data-target="recordContent" title="Unterstrichen"><u>U</u></button>
            <button type="button" data-mdt-format="h1" data-target="recordContent">H1</button>
            <button type="button" data-mdt-format="h2" data-target="recordContent">H2</button>
            <button type="button" data-mdt-format="h3" data-target="recordContent">H3</button>
            <button type="button" data-mdt-format="list" data-target="recordContent">• Liste</button>
            <button type="button" data-mdt-format="table" data-target="recordContent">Tabelle</button>
          </div>
          <div class="records-editor-workspace"><textarea maxlength="200000" id="recordContent" class="records-form-textarea" data-mdt-editor placeholder="Vollständiger Akteninhalt..."></textarea>
          <div class="records-rich-preview" data-record-rich-preview><div class="records-rich-preview-label">Vorschau</div><div class="mdt-rich-content">Der Akteninhalt wird hier formatiert angezeigt.</div></div></div>
        </div>
      </div>
    `;
  }

  function editForm(record) {
    const type = getType(record.type);
    if (!type) return "";

    return `
      ${securityPanel(type)}

      <div class="records-form-grid">
        <div class="records-form-group">
          <label class="records-form-label">Aktenzeichen</label>
          <input class="records-form-input" type="text" readonly value="${escapeAttr(record.case_number || "")}">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Aktenart</label>
          <input class="records-form-input" type="text" readonly value="${escapeAttr(type.shortLabel)}">
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Titel</label>
          <input id="recordTitle" class="records-form-input" maxlength="160" value="${escapeAttr(record.title || "")}">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Betreff</label>
          <input id="recordSubject" class="records-form-input" maxlength="160" value="${escapeAttr(record.subject || "")}">
        </div>

        <div class="records-form-group">
          <label class="records-form-label">Status</label>
          <select id="recordStatus" class="records-form-select">${statusOptions(record.status)}</select>
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Kurzfassung</label>
          <input id="recordSummary" class="records-form-input" maxlength="500" value="${escapeAttr(record.summary || "")}">
        </div>

        <div class="records-form-group full">
          <label class="records-form-label">Akteninhalt</label>
          <div class="records-rich-toolbar" aria-label="Textformatierung">
            <button type="button" data-mdt-format="bold" data-target="recordContent" title="Fett"><strong>B</strong></button>
            <button type="button" data-mdt-format="italic" data-target="recordContent" title="Kursiv"><em>I</em></button>
            <button type="button" data-mdt-format="underline" data-target="recordContent" title="Unterstrichen"><u>U</u></button>
            <button type="button" data-mdt-format="h1" data-target="recordContent">H1</button>
            <button type="button" data-mdt-format="h2" data-target="recordContent">H2</button>
            <button type="button" data-mdt-format="h3" data-target="recordContent">H3</button>
            <button type="button" data-mdt-format="list" data-target="recordContent">• Liste</button>
            <button type="button" data-mdt-format="table" data-target="recordContent">Tabelle</button>
          </div>
          <div class="records-editor-workspace"><textarea maxlength="200000" id="recordContent" class="records-form-textarea" data-mdt-editor>${escapeHtml(record.content || "")}</textarea>
          <div class="records-rich-preview" data-record-rich-preview><div class="records-rich-preview-label">Vorschau</div><div class="mdt-rich-content">${window.MDTRichText ? window.MDTRichText.render(record.content || "") : escapeHtml(record.content || "")}</div></div></div>
        </div>
      </div>
    `;
  }

  function previewType(typeId) {
    const container = document.getElementById("recordSecurityPreview");
    const type = getType(typeId);
    if (container && type) container.innerHTML = securityPanel(type);
    state.modalType = typeId;
  }

  function readForm() {
    return {
      type: state.modalType || state.currentRecord?.type || state.currentTab,
      title: document.getElementById("recordTitle")?.value.trim() || "",
      subject: document.getElementById("recordSubject")?.value.trim() || "",
      status: document.getElementById("recordStatus")?.value || "open",
      summary: document.getElementById("recordSummary")?.value.trim() || "",
      content: document.getElementById("recordContent")?.value || ""
    };
  }

  function openCreateModal() {
    const creatable = getCreatableTypes();
    if (!creatable.length) {
      notifyRecords("error", "Keine Berechtigung", "Du besitzt keine Berechtigung zum Erstellen von Akten.");
      return;
    }

    let defaultType = state.currentTab;
    if (!TYPES[defaultType] || !can(TYPES[defaultType].create)) defaultType = creatable[0];

    state.modalMode = "create";
    state.currentRecord = null;
    state.modalType = defaultType;

    openModal(
      "+ " + TYPES[defaultType].shortLabel,
      TYPES[defaultType].classification,
      createForm(defaultType),
      true,
      "Erstellen"
    );
  }

  function openEditModal(recordId) {
    const record = state.records.find(function (item) {
      return String(item.id) === String(recordId);
    });

    if (!record) {
      notifyRecords("error", "Akte nicht verfügbar", "Die Akte ist in der aktuellen Liste nicht vorhanden.");
      return;
    }

    const type = getType(record.type);
    if (!type || !can(type.edit)) {
      notifyRecords("error", "Kein Zugriff", "Du besitzt keine Bearbeitungsberechtigung für diese Aktenart.");
      return;
    }

    state.modalMode = "edit";
    state.currentRecord = record;
    state.modalType = record.type;

    const detailRequest = openModalLoading(
      "Akte bearbeiten",
      (record.case_number || record.caseNumber || "") + " · " + (type.classification || ""),
      "Akte wird geladen..."
    );

    CloudApi.run
      .withSuccessHandler(function (fullRecord) {
        if(!modalRequestValid(detailRequest))return;
        if(fullRecord.status==="archived"){renderDetail(fullRecord);return;}
        state.currentRecord = fullRecord;
        state.modalType = fullRecord.type;

        openModal(
          "Akte bearbeiten",
          (fullRecord.case_number || fullRecord.caseNumber || "") + " · " + (type.classification || ""),
          editForm(fullRecord),
          true,
          "Speichern"
        );
      })
      .withFailureHandler(function (error) {
        if(!modalRequestValid(detailRequest))return;
        closeModal();
        notifyRecords("error", "Akte konnte nicht geöffnet werden", error?.message || "Die Detailansicht konnte nicht geladen werden.");
      })
      .getRecord(token(), recordId);
  }

  function renderDetail(record) {
    const type = getType(record.type) || {
      label: record.type || "Unbekannt",
      shortLabel: record.type || "Unbekannt",
      classification: record.classification || "—",
      icon: "fa-folder"
    };
    const status = STATUSES[record.status] || { label: record.status || "Unbekannt", className: "inactive" };

    openModal(
      record.title || type.shortLabel,
      (record.case_number || record.caseNumber || "") + " · " + type.classification,
      `
        ${securityPanel(type)}

        <div class="records-detail-meta">
          <div class="records-detail-meta-card">
            <div class="records-detail-meta-label">Aktenzeichen</div>
            <div class="records-detail-meta-value">${escapeHtml(record.case_number || record.caseNumber || "—")}</div>
          </div>
          <div class="records-detail-meta-card">
            <div class="records-detail-meta-label">Status</div>
            <div class="records-detail-meta-value"><span class="records-status-badge ${escapeAttr(status.className)}">${escapeHtml(status.label)}</span></div>
          </div>
          <div class="records-detail-meta-card">
            <div class="records-detail-meta-label">Erstellt</div>
            <div class="records-detail-meta-value">${escapeHtml(formatDate(record.created_at || record.createdAt))}</div>
          </div>
          <div class="records-detail-meta-card">
            <div class="records-detail-meta-label">Aktualisiert</div>
            <div class="records-detail-meta-value">${escapeHtml(formatDate(record.updated_at || record.updatedAt))}</div>
          </div>
        </div>

        <div class="records-detail-section">
          <div class="records-detail-section-title">Betreff</div>
          <div class="records-detail-content">${escapeHtml(record.subject || "—")}</div>
        </div>

        <div class="records-detail-section">
          <div class="records-detail-section-title">Kurzfassung</div>
          <div class="records-detail-content">${escapeHtml(record.summary || "Keine Kurzfassung vorhanden.")}</div>
        </div>

        <div class="records-detail-section">
          <div class="records-detail-section-title">Akteninhalt</div>
          <div class="records-detail-content">${record.content ? (window.MDTRichText ? window.MDTRichText.render(record.content) : formatRecordText(record.content)) : '<span class="records-detail-empty">Kein Akteninhalt hinterlegt.</span>'}</div>
        </div>

        ${can(type.edit)?`<div class="records-detail-section records-share-tools">
          <div class="records-detail-section-title">Externe Freigaben</div>
          <p class="records-share-note">Jeder mit dem Link kann diese Akte bis zum Ablauf oder Widerruf einsehen.</p>
          <div class="records-share-controls"><select id="recordShareDuration" class="records-form-select" aria-label="Gültigkeitsdauer"><option value="60">1 Stunde</option><option value="240">4 Stunden</option><option value="1440" selected>24 Stunden</option><option value="4320">3 Tage</option><option value="10080">7 Tage</option></select><button type="button" class="records-button" id="recordShareCreate">Link erstellen</button><button type="button" class="records-button" id="recordShareListButton">Freigaben anzeigen</button></div>
          <div id="recordShareOutput" aria-live="polite"></div><div id="recordShareList"></div>
        </div>`:""}
        <div class="records-detail-section">
          <div class="records-detail-section-title">Dokumentation</div>
          <div class="records-detail-content">Erstellt von ${escapeHtml(record.created_by_name || record.createdBy || "Unbekannt")} am ${escapeHtml(formatDate(record.created_at || record.createdAt))}.\nZuletzt bearbeitet von ${escapeHtml(record.updated_by_name || record.updatedBy || "Unbekannt")} am ${escapeHtml(formatDate(record.updated_at || record.updatedAt))}.</div>
        </div>
      `,
      false,
      ""
    );

    const modal = getGlobalModal();
    const footer = modal?.getFooter();
    if (!footer) return;

    footer.querySelectorAll("[data-fib-modal-custom]").forEach(function (node) {
      node.remove();
    });

    const addAction = function (label, className, handler) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "records-button" + (className ? " " + className : "");
      button.dataset.fibModalCustom = "true";
      button.textContent = label;
      button.addEventListener("click", handler);
      footer.insertBefore(button, footer.lastElementChild || null);
    };

    const shareCreate=document.getElementById("recordShareCreate"),shareListButton=document.getElementById("recordShareListButton"),shareList=document.getElementById("recordShareList"),shareOutput=document.getElementById("recordShareOutput");
    async function loadShares(){if(!shareList?.isConnected)return;shareListButton.disabled=true;shareList.textContent="Freigaben werden geladen …";try{const rows=await window.runServer("getRecordShares",token(),record.id);if(!shareList.isConnected)return;shareList.innerHTML=rows.length?rows.map(r=>`<div class="records-share-row"><div><strong>${escapeHtml(r.created_by_name||"Unbekannt")}</strong><div class="records-secondary">Gültig bis ${escapeHtml(formatDate(r.expires_at))} · ${r.revoked_at?"Widerrufen":r.active?"Aktiv":"Abgelaufen"}</div></div>${r.active?`<button type="button" class="records-button small" data-share-revoke="${escapeAttr(r.id)}">Widerrufen</button>`:""}</div>`).join(""):"Keine Freigaben vorhanden.";}catch(e){if(shareList.isConnected)shareList.textContent=e.message||"Freigaben konnten nicht geladen werden.";}finally{if(shareListButton.isConnected)shareListButton.disabled=false;}}
    if(shareListButton)shareListButton.onclick=loadShares;
    if(shareList)shareList.addEventListener("click",async e=>{const b=e.target.closest("[data-share-revoke]");if(!b||!window.confirm("Diese externe Freigabe widerrufen?"))return;b.disabled=true;try{await window.runServer("revokeRecordShare",token(),b.dataset.shareRevoke);await loadShares();}catch(e){b.disabled=false;notifyRecords("error","Widerruf fehlgeschlagen",e.message);}});
    if(shareCreate)shareCreate.onclick=async()=>{if(!window.confirm("Externe Freigabe erstellen? Jeder mit dem Link kann den Inhalt einsehen."))return;shareCreate.disabled=true;try{const result=await window.runServer("createRecordShare",token(),record.id,Number(document.getElementById("recordShareDuration")?.value||1440));if(!shareOutput.isConnected)return;const url=new URL(result.url,document.baseURI).href;shareOutput.replaceChildren();const input=document.createElement("input");input.className="records-form-input";input.readOnly=true;input.value=url;input.setAttribute("aria-label","Externer Freigabelink");input.onclick=()=>input.select();const copy=document.createElement("button");copy.type="button";copy.className="records-button";copy.textContent="Kopieren";copy.onclick=async()=>{try{await navigator.clipboard.writeText(url);copy.textContent="Kopiert";}catch(_){input.focus();input.select();}};shareOutput.append(input,copy);await loadShares();}catch(e){notifyRecords("error","Freigabe fehlgeschlagen",e.message);}finally{if(shareCreate.isConnected)shareCreate.disabled=false;}};

    if (record.status !== "archived" && can(type.edit)) {
      addAction("Bearbeiten", "", function () {
        closeModal();
        openEditModal(record.id);
      });

      addAction("Archivieren", "", function () {
        closeModal();
        archiveRecord(record.id, record.type);
      });
    }

    if (isMasterAccount()) {
      addAction("Löschen", "danger", function () {
        closeModal();
        deleteRecord(record.id);
      });
    }
  }

  function openRecord(recordId) {
    const item = state.records.find(function (record) {
      return String(record.id) === String(recordId);
    });

    let detailRequest;
    if (item) {
      const type = getType(item.type);
      detailRequest=openModalLoading(
        item.title || (type ? type.shortLabel : "Akte"),
        (item.case_number || item.caseNumber || "") + " · " + (type ? type.classification : ""),
        "Akte wird geladen..."
      );
    } else {
      detailRequest=openModalLoading("Akte", "", "Akte wird geladen...");
    }

    CloudApi.run
      .withSuccessHandler(function (record) {
        if(!modalRequestValid(detailRequest))return;
        renderDetail(record);
      })
      .withFailureHandler(function (error) {
        if(!modalRequestValid(detailRequest))return;
        closeModal();
        notifyRecords("error", "Akte konnte nicht geöffnet werden", error?.message || "Die Detailansicht konnte nicht geladen werden.");
      })
      .getRecord(token(), recordId);
  }

  function saveModal() {
    if (state.busy) return false;

    const data = readForm();
    if(state.modalMode==="edit")data.expectedUpdatedAt=state.currentRecord?.updated_at||"";
    const formNode=document.getElementById("recordTitle");
    const sameForm=()=>state.alive&&root.isConnected&&formNode?.isConnected&&document.getElementById("recordTitle")===formNode;
    if (!data.title) {
      notifyRecords("error", "Eingabe fehlt", "Bitte einen Titel eingeben.");
      return false;
    }

    if (!data.type || !TYPES[data.type]) {
      notifyRecords("error", "Eingabe fehlt", "Bitte eine gültige Aktenart auswählen.");
      return false;
    }

    const type = TYPES[data.type];
    const requiredPermission = state.modalMode === "create" ? type.create : type.edit;
    if (!can(requiredPermission)) {
      notifyRecords("error", "Kein Zugriff", "Du besitzt die erforderliche Berechtigung nicht.");
      return false;
    }

    setBusy(true, state.modalMode === "create" ? "Erstellen..." : "Speichern...");

    if (state.modalMode === "create") {
      CloudApi.run
        .withSuccessHandler(function (record) {
          if(!state.alive||!root.isConnected)return;
          const originalForm=sameForm();
          if(originalForm)closeModal();
          invalidateCache();

          if (originalForm && record && record.type) {
            state.currentTab = record.type;
            state.currentStatus = "all";
            state.page=0;state.search="";document.getElementById("recordsSearch").value="";
            buildTabs();
            updateToolbar();
            updateCreateButton();
          }

          loadCurrent(true);
          notifyRecords("success", "Akte erstellt", "Die Akte wurde erfolgreich erstellt.");
        })
        .withFailureHandler(function (error) {
          if(!sameForm())return;
          setBusy(false, "Erstellen");
          notifyRecords("error", "Akte konnte nicht erstellt werden", error?.message || "Die Akte konnte nicht erstellt werden.");
        })
        .createRecord(token(), data);

      return true;
    }

    CloudApi.run
      .withSuccessHandler(function (record) {
        if(!state.alive||!root.isConnected)return;
        if(sameForm())closeModal();
        invalidateCache();
        loadCurrent(true);
        notifyRecords("success", "Akte gespeichert", "Die Akte wurde erfolgreich aktualisiert.");
      })
      .withFailureHandler(function (error) {
        if(!sameForm())return;
        setBusy(false, "Speichern");
        notifyRecords("error", "Akte konnte nicht gespeichert werden", error?.message || "Die Akte konnte nicht aktualisiert werden.");
      })
      .updateRecord(token(), state.currentRecord.id, data);

    return true;
  }

  function archiveRecord(recordId, typeId) {
    if (!window.confirm("Soll diese Akte wirklich archiviert werden?")) return;

    CloudApi.run
      .withSuccessHandler(function () {
        invalidateCache();
        loadCurrent(true);
        notifyRecords("success", "Akte archiviert", "Die Akte wurde in das Archiv verschoben.");
      })
      .withFailureHandler(function (error) {
        notifyRecords("error", "Archivierung fehlgeschlagen", error?.message || "Die Akte konnte nicht archiviert werden.");
      })
      .archiveRecord(token(), recordId, typeId);
  }

  function deleteRecord(recordId) {
    if (!isMasterAccount()) {
      notifyRecords("error", "Kein Zugriff", "Nur Master-Accounts dürfen Akten endgültig löschen.");
      return;
    }

    if (!window.confirm("Diese Akte wird endgültig gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden. Fortfahren?")) return;

    CloudApi.run
      .withSuccessHandler(function () {
        invalidateCache();
        loadCurrent(true);
        notifyRecords("success", "Akte gelöscht", "Die Akte wurde endgültig gelöscht.");
      })
      .withFailureHandler(function (error) {
        notifyRecords("error", "Löschen fehlgeschlagen", error?.message || "Die Akte konnte nicht gelöscht werden.");
      })
      .deleteRecord(token(), recordId);
  }

  function initialize() {
    if (state.initialized) {
      buildTabs();
      updateToolbar();
      updateCreateButton();
      loadCurrent(false);
      return;
    }

    state.initialized = true;

    if (window.MDTRichText && !document.body.dataset.recordsRichTools) {
      window.MDTRichText.attachToolbar(document.body);
      document.body.dataset.recordsRichTools = "1";
      document.body.addEventListener("input", function (event) {
        if (event.target && event.target.id === "recordContent") {
          const preview = document.querySelector("[data-record-rich-preview] .mdt-rich-content");
          if (preview) preview.innerHTML = window.MDTRichText.render(event.target.value || "");
        }
      });
    }

    if (!token()) {
      renderEmpty("Keine aktive Sitzung", "Bitte melde dich erneut an.");
      return;
    }

    const visible = getVisibleTabs();
    if (!visible.length) {
      renderEmpty("Keine Aktenberechtigung", "Für deinen Account ist keine Aktenart freigeschaltet.");
      return;
    }

    state.currentTab = visible.includes(state.currentTab) ? state.currentTab : visible[0];
    state.currentStatus = state.currentTab === "archive" ? "archived" : "all";

    buildTabs();
    updateToolbar();
    updateCreateButton();
    window.FIB_MDT_SELECTS?.refresh?.();
    loadCurrent(false);
  }

  state.cleanup = function () {
    state.alive=false;
    state.requestId += 1;
    state.modalRequestId += 1;
    if (document.querySelector("#fibGlobalModalOverlay.fib-modal-records-mode.open")) closeModal();
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = null;
    state.initialized = false;
  };

  life.addCleanup(state.cleanup);
  document.getElementById("recordsTableBody").addEventListener("click",e=>{const open=e.target.closest("[data-record-open]"),edit=e.target.closest("[data-record-edit]");if(open)openRecord(open.dataset.recordOpen);if(edit)openEditModal(edit.dataset.recordEdit);});
  document.getElementById("recordsPrevPage").onclick=()=>changePage(-1);
  document.getElementById("recordsNextPage").onclick=()=>changePage(1);
  window.recordsOpenTab = openTab;
  window.recordsLoadCurrent = function () { loadCurrent(true); };
  life.on(window,"fib-mdt:refresh-request",function(){if(state.alive&&!state.pendingKey&&!document.querySelector("#fibGlobalModalOverlay.open")){const visible=getVisibleTabs();if(!visible.includes(state.currentTab)){state.currentTab=visible[0]||"";state.page=0;buildTabs();updateToolbar();updateCreateButton();}loadCurrent(true,true);}});
  life.on(window,"fib-mdt:data-changed",function(event){if(/Record|Akten|record/i.test(String(event.detail?.method||""))){invalidateCache();}});
  window.recordsSearchChanged = searchChanged;
  window.recordsStatusChanged = statusChanged;
  window.recordsOpenRecord = openRecord;
  window.recordsOpenEditModal = openEditModal;
  window.recordsOpenCreateModal = openCreateModal;
  window.recordsPreviewType = previewType;
  window.recordsSaveModal = saveModal;
  window.recordsCloseModal = closeModal;
  window.recordsArchive = archiveRecord;
  window.recordsDelete = deleteRecord;

  if (!state.eventsBound) {
    state.eventsBound = true;

    // Die globalen Modal-Events werden zentral im Index verwaltet.
    // Hier werden deshalb bewusst KEINE weiteren Escape-/Backdrop-Listener registriert.
  }

  life.timeout(initialize, 0);
})();
