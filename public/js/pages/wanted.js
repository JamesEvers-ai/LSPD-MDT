
(function () {
  "use strict";

  const state = window.wantedPageState = window.wantedPageState || {
    initialized: false,
    data: [],
    filtered: [],
    active: [],
    captured: [],
    loaded: false,
    loading: false,
    permissions: { view: false, create: false, edit: false, delete: false },
    config: null,
    search: "",
    typeFilter: "all",
    statusFilter: "all",
    modalMode: null,
    modalId: null,
    modalButton: null,
    clockInterval: null
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function text(value) { return String(value ?? "").trim(); }
  function normalize(value) { return text(value).toLowerCase(); }

  function token() {
    try {
      if (typeof getSystemSessionToken === "function") {
        const t = getSystemSessionToken();
        if (t) return t;
      }
    } catch (e) {}

    try {
      if (typeof sessionToken !== "undefined" && sessionToken) return sessionToken;
    } catch (e) {}

    return window.currentSessionToken || window.sessionToken || "";
  }

  function modal() {
    return window.FIB_MDT_MODAL || null;
  }

  function showModalError(title, message) {
    const m = modal();
    if (!m) {
      window.alert(message || title || "Fehler");
      return;
    }

    m.open({
      title: title || "Fehler",
      subtitle: "Fahndungsregister",
      body: '<div class="wanted-modal-error">' + escapeHtml(message || "Ein unbekannter Fehler ist aufgetreten.") + '</div>',
      saveVisible: false,
      focus: false
    });
  }

  function closeModal() {
    const m = modal();
    if (m) m.close();
    state.modalMode = null;
    state.modalId = null;
    state.modalButton = null;
  }

  function valueOf(id) {
    const el = $(id);
    return el ? text(el.value) : "";
  }

  function checkedOf(id) {
    const el = $(id);
    return !!(el && el.checked);
  }

  function setValue(id, value) {
    const el = $(id);
    if (el) el.value = value ?? "";
  }

  function setChecked(id, value) {
    const el = $(id);
    if (el) el.checked = !!value;
  }

  function typeLabel(type) {
    return normalize(type) === "vehicle" ? "Fahrzeug" : "Person";
  }

  function statusConfig(status) {
    const key = normalize(status);
    const values = {
      wanted: { label: "Gesucht", cls: "active" },
      observation: { label: "Beobachtung", cls: "watch" },
      captured: { label: "Gefasst", cls: "captured" }
    };
    return values[key] || { label: "Unbekannt", cls: "unknown" };
  }

  function dangerConfig(level) {
    const key = normalize(level);
    const values = {
      low: { label: "Niedrig", cls: "low" },
      medium: { label: "Mittel", cls: "medium" },
      high: { label: "Hoch", cls: "high" },
      extreme: { label: "Sehr hoch", cls: "extreme" }
    };
    return values[key] || { label: "Unbekannt", cls: "unknown" };
  }

  function formatDate(value) {
    const raw = text(value);
    if (!raw) return "—";
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime()) && /T|Z|-/.test(raw)) {
      return date.toLocaleDateString("de-DE");
    }
    return escapeHtml(raw);
  }

  function formatBoolean(value) {
    if (value === true || ["true", "ja", "1", "yes"].includes(normalize(value))) {
      return '<span class="wanted-bool yes">JA</span>';
    }
    return '<span class="wanted-bool no">NEIN</span>';
  }

  function identifier(row) {
    return row.type === "vehicle" ? row.plate : row.person_id;
  }

  function secondary(row) {
    if (row.type === "vehicle") {
      const parts = [text(row.vehicle_model), text(row.vehicle_color)].filter(Boolean);
      return parts.join(" · ");
    }
    return text(row.alias);
  }

  function cleanRow(row) {
    const r = row || {};
    return {
      id: text(r.id),
      type: normalize(r.type) === "vehicle" ? "vehicle" : "person",
      name: text(r.name),
      alias: text(r.alias),
      person_id: text(r.person_id),
      plate: text(r.plate),
      vehicle_model: text(r.vehicle_model),
      vehicle_color: text(r.vehicle_color),
      reason: text(r.reason),
      armed: r.armed === true || normalize(r.armed) === "true",
      danger_level: normalize(r.danger_level),
      last_seen: text(r.last_seen),
      wanted_since: text(r.wanted_since),
      captured_at: text(r.captured_at),
      description: text(r.description),
      notes: text(r.notes),
      status: normalize(r.status) || "wanted",
      created_at: text(r.created_at),
      created_by_user_id: text(r.created_by_user_id),
      created_by_name: text(r.created_by_name),
      updated_at: text(r.updated_at),
      updated_by_user_id: text(r.updated_by_user_id),
      updated_by_name: text(r.updated_by_name)
    };
  }

  function matches(row) {
    if (state.typeFilter !== "all" && row.type !== state.typeFilter) return false;
    if (state.statusFilter !== "all" && row.status !== state.statusFilter) return false;

    const q = normalize(state.search);
    if (!q) return true;

    const haystack = [
      row.type, row.name, row.alias, row.person_id, row.plate,
      row.vehicle_model, row.vehicle_color, row.reason,
      row.danger_level, row.last_seen, row.wanted_since,
      row.captured_at, row.description, row.notes,
      row.created_by_name, row.updated_by_name
    ].map(normalize).join(" ");

    return haystack.includes(q);
  }

  function loadingRow(colspan) {
    return '<tr><td colspan="' + colspan + '" class="wanted-state loading">' +
      '<div class="wanted-loading-content">' +
        '<span class="wanted-loading-spinner" aria-hidden="true"></span>' +
        '<span class="wanted-loading-text">Fahndungsregister wird geladen …</span>' +
      '</div>' +
    '</td></tr>';
  }

  function showLoadingState() {
    const active = $("wantedActiveBody");
    const captured = $("wantedCapturedBody");
    if (active) active.innerHTML = loadingRow(11);
    if (captured) captured.innerHTML = loadingRow(7);
  }

  function render() {
    if (!state.loaded) {
      showLoadingState();
      return;
    }

    state.filtered = state.data.filter(matches);
    state.active = state.filtered.filter(row => row.status !== "captured");
    state.captured = state.filtered.filter(row => row.status === "captured");

    renderActive();
    renderCaptured();

    const total = $("wantedTotalCount");
    const active = $("wantedActiveCount");
    const captured = $("wantedCapturedCount");
    const activeSection = $("wantedActiveSectionCount");
    const capturedSection = $("wantedCapturedSectionCount");

    if (total) total.textContent = state.filtered.length;
    if (active) active.textContent = state.active.length;
    if (captured) captured.textContent = state.captured.length;
    if (activeSection) activeSection.textContent = state.active.length;
    if (capturedSection) capturedSection.textContent = state.captured.length;
  }

  function emptyRow(message, colspan) {
    return '<tr><td colspan="' + colspan + '" class="wanted-state"><strong>' +
      escapeHtml(message) + '</strong>Für den gewählten Filter liegen keine Einträge vor.</td></tr>';
  }

  function renderActive() {
    const body = $("wantedActiveBody");
    if (!body) return;

    if (!state.active.length) {
      body.innerHTML = emptyRow("Keine aktiven Fahndungen gefunden", 11);
      return;
    }

    body.innerHTML = state.active.map(function(row) {
      const status = statusConfig(row.status);
      const danger = dangerConfig(row.danger_level);
      const sub = secondary(row);
      const id = identifier(row);
      const actions = [];

      if (state.permissions.edit) {
        actions.push('<button type="button" class="wanted-icon-btn" data-action="edit" data-id="' + escapeHtml(row.id) + '" title="Bearbeiten">✎</button>');
      }
      if (state.permissions.delete) {
        actions.push('<button type="button" class="wanted-icon-btn delete" data-action="delete" data-id="' + escapeHtml(row.id) + '" title="Löschen">✕</button>');
      }

      return '<tr>' +
        '<td><span class="wanted-type">' + escapeHtml(typeLabel(row.type)) + '</span></td>' +
        '<td><div class="wanted-primary-text">' + escapeHtml(row.name || "—") + '</div>' + (sub ? '<div class="wanted-secondary-text">' + escapeHtml(sub) + '</div>' : '') + '</td>' +
        '<td>' + (id ? escapeHtml(id) : '<span class="muted">—</span>') + '</td>' +
        '<td><span class="wanted-status ' + status.cls + '">' + escapeHtml(status.label) + '</span></td>' +
        '<td>' + (row.reason ? escapeHtml(row.reason) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + formatBoolean(row.armed) + '</td>' +
        '<td><span class="wanted-danger ' + danger.cls + '">' + escapeHtml(danger.label) + '</span></td>' +
        '<td>' + (row.last_seen ? escapeHtml(row.last_seen) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + formatDate(row.wanted_since) + '</td>' +
        '<td>' + (row.created_by_name ? escapeHtml(row.created_by_name) : '<span class="muted">—</span>') + '</td>' +
        '<td><div class="wanted-row-actions">' + actions.join("") + '</div></td>' +
      '</tr>';
    }).join("");

    attachActions(body);
  }

  function renderCaptured() {
    const body = $("wantedCapturedBody");
    if (!body) return;

    if (!state.captured.length) {
      body.innerHTML = emptyRow("Keine gefassten Personen oder Fahrzeuge gefunden", 7);
      return;
    }

    body.innerHTML = state.captured.map(function(row) {
      const sub = secondary(row);
      const id = identifier(row);
      const actions = [];

      if (state.permissions.edit) {
        actions.push('<button type="button" class="wanted-icon-btn" data-action="edit" data-id="' + escapeHtml(row.id) + '" title="Bearbeiten">✎</button>');
      }
      if (state.permissions.delete) {
        actions.push('<button type="button" class="wanted-icon-btn delete" data-action="delete" data-id="' + escapeHtml(row.id) + '" title="Löschen">✕</button>');
      }

      return '<tr>' +
        '<td><span class="wanted-type">' + escapeHtml(typeLabel(row.type)) + '</span></td>' +
        '<td><div class="wanted-primary-text">' + escapeHtml(row.name || "—") + '</div>' + (sub ? '<div class="wanted-secondary-text">' + escapeHtml(sub) + '</div>' : '') + '</td>' +
        '<td>' + (id ? escapeHtml(id) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + (row.reason ? escapeHtml(row.reason) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + formatDate(row.captured_at) + '</td>' +
        '<td>' + (row.created_by_name ? escapeHtml(row.created_by_name) : '<span class="muted">—</span>') + '</td>' +
        '<td><div class="wanted-row-actions">' + actions.join("") + '</div></td>' +
      '</tr>';
    }).join("");

    attachActions(body);
  }

  function attachActions(body) {
    body.querySelectorAll("[data-action]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (action === "edit") openEditModal(id);
        if (action === "delete") openDeleteModal(id);
      });
    });
  }

  function loadWanted(showLoader) {
    if (state.loading) return;
    const t = token();
    if (!t) {
      showTableError("Keine gültige Sitzung vorhanden.");
      return;
    }

    state.loading = true;
    state.loaded = false;
    if (showLoader) {
      showLoadingState();
    }

    CloudApi.run
      .withSuccessHandler(function(result) {
        state.loading = false;
        state.loaded = true;
        state.data = Array.isArray(result) ? result.map(cleanRow) : [];
        render();
      })
      .withFailureHandler(function(error) {
        state.loading = false;
        state.loaded = false;
        showTableError(error && error.message ? error.message : "Die Daten konnten nicht geladen werden.");
      })
      .getWanted(t, "", 200);
  }

  function showTableError(message) {
    state.loaded = false;
    const active = $("wantedActiveBody");
    const captured = $("wantedCapturedBody");
    if (active) active.innerHTML = '<tr><td colspan="11" class="wanted-state error"><strong>Daten konnten nicht geladen werden</strong>' + escapeHtml(message) + '</td></tr>';
    if (captured) captured.innerHTML = '<tr><td colspan="7" class="wanted-state error"><strong>Daten konnten nicht geladen werden</strong>' + escapeHtml(message) + '</td></tr>';
  }

  function loadConfig() {
    const t = token();
    if (!t) {
      showTableError("Keine gültige Sitzung vorhanden.");
      return;
    }

    CloudApi.run
      .withSuccessHandler(function(config) {
        state.config = config || {};
        state.permissions = (config && config.permissions) || state.permissions;
        const createButton = $("wantedNewButton");
        if (createButton) createButton.style.display = state.permissions.create ? "" : "none";
        loadWanted(true);
      })
      .withFailureHandler(function(error) {
        showTableError(error && error.message ? error.message : "Die Fahndungsberechtigungen konnten nicht geladen werden.");
      })
      .getWantedConfig(t);
  }

  function formHtml(row) {
    const current = row || {};
    const type = normalize(current.type) === "vehicle" ? "vehicle" : "person";

    return '<div id="wantedModalFormRoot" class="wanted-modal-surface">' +
      '<div class="wanted-modal-info">Pflichtfelder sind mit <span class="required-mark">*</span> gekennzeichnet. Die Fahndung wird mit dem angemeldeten Benutzer als Ersteller gespeichert.</div>' +
      '<div class="wanted-modal-form">' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldType">Art <span class="required">*</span></label>' +
          '<select id="wantedFieldType" class="wanted-modal-input">' +
            '<option value="person"' + (type === "person" ? ' selected' : '') + '>Person</option>' +
            '<option value="vehicle"' + (type === "vehicle" ? ' selected' : '') + '>Fahrzeug</option>' +
          '</select>' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label id="wantedNameLabel" class="wanted-modal-label" for="wantedFieldName">' + (type === "vehicle" ? 'Fahrzeugbezeichnung' : 'Name') + ' <span class="required">*</span></label>' +
          '<input id="wantedFieldName" class="wanted-modal-input" type="text" value="' + escapeHtml(current.name || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group" id="wantedPersonOnlyAlias">' +
          '<label class="wanted-modal-label" for="wantedFieldAlias">Alias</label>' +
          '<input id="wantedFieldAlias" class="wanted-modal-input" type="text" value="' + escapeHtml(current.alias || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group" id="wantedPersonOnlyId">' +
          '<label class="wanted-modal-label" for="wantedFieldPersonId">Reisepassnummer</label>' +
          '<input id="wantedFieldPersonId" class="wanted-modal-input" type="text" value="' + escapeHtml(current.person_id || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group" id="wantedVehicleOnlyPlate">' +
          '<label class="wanted-modal-label" for="wantedFieldPlate">Kennzeichen</label>' +
          '<input id="wantedFieldPlate" class="wanted-modal-input" type="text" value="' + escapeHtml(current.plate || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group" id="wantedVehicleOnlyModel">' +
          '<label class="wanted-modal-label" for="wantedFieldVehicleModel">Fahrzeugmodell</label>' +
          '<input id="wantedFieldVehicleModel" class="wanted-modal-input" type="text" value="' + escapeHtml(current.vehicle_model || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group" id="wantedVehicleOnlyColor">' +
          '<label class="wanted-modal-label" for="wantedFieldVehicleColor">Fahrzeugfarbe</label>' +
          '<input id="wantedFieldVehicleColor" class="wanted-modal-input" type="text" value="' + escapeHtml(current.vehicle_color || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldStatus">Status</label>' +
          '<select id="wantedFieldStatus" class="wanted-modal-input">' +
            '<option value="wanted"' + (normalize(current.status) === "wanted" || !current.status ? ' selected' : '') + '>Gesucht</option>' +
            '<option value="observation"' + (normalize(current.status) === "observation" ? ' selected' : '') + '>Beobachtung</option>' +
            '<option value="captured"' + (normalize(current.status) === "captured" ? ' selected' : '') + '>Gefasst</option>' +
          '</select>' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldDanger">Gefährlichkeit</label>' +
          '<select id="wantedFieldDanger" class="wanted-modal-input">' +
            '<option value="low"' + (normalize(current.danger_level) === "low" ? ' selected' : '') + '>Niedrig</option>' +
            '<option value="medium"' + (normalize(current.danger_level) === "medium" || !current.danger_level ? ' selected' : '') + '>Mittel</option>' +
            '<option value="high"' + (normalize(current.danger_level) === "high" ? ' selected' : '') + '>Hoch</option>' +
            '<option value="extreme"' + (normalize(current.danger_level) === "extreme" ? ' selected' : '') + '>Sehr hoch</option>' +
          '</select>' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldWantedSince">Gesucht seit</label>' +
          '<input id="wantedFieldWantedSince" class="wanted-modal-input" type="date" value="' + escapeHtml((current.wanted_since || "").slice(0,10)) + '">' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldCapturedAt">Gefasst am</label>' +
          '<input id="wantedFieldCapturedAt" class="wanted-modal-input" type="date" value="' + escapeHtml((current.captured_at || "").slice(0,10)) + '">' +
        '</div>' +
        '<div class="wanted-modal-group">' +
          '<label class="wanted-modal-label" for="wantedFieldLastSeen">Zuletzt gesehen</label>' +
          '<input id="wantedFieldLastSeen" class="wanted-modal-input" type="text" value="' + escapeHtml(current.last_seen || "") + '">' +
        '</div>' +
        '<div class="wanted-modal-group wanted-modal-group-checkbox">' +
          '<label class="wanted-modal-checkbox"><input id="wantedFieldArmed" type="checkbox"' + (current.armed ? ' checked' : '') + '> Bewaffnet</label>' +
        '</div>' +
        '<div class="wanted-modal-group full">' +
          '<label class="wanted-modal-label" for="wantedFieldReason">Straftat / Grund <span class="required">*</span></label>' +
          '<textarea id="wantedFieldReason" class="wanted-modal-input" rows="3">' + escapeHtml(current.reason || "") + '</textarea>' +
          '<div class="wanted-modal-help">Der konkrete Fahndungsgrund bzw. die zugrunde liegende Straftat.</div>' +
        '</div>' +
        '<div class="wanted-modal-group full">' +
          '<label class="wanted-modal-label" for="wantedFieldDescription">Beschreibung</label>' +
          '<textarea id="wantedFieldDescription" class="wanted-modal-input" rows="3">' + escapeHtml(current.description || "") + '</textarea>' +
        '</div>' +
        '<div class="wanted-modal-group full">' +
          '<label class="wanted-modal-label" for="wantedFieldNotes">Interne Anmerkungen</label>' +
          '<textarea id="wantedFieldNotes" class="wanted-modal-input" rows="3">' + escapeHtml(current.notes || "") + '</textarea>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function applyTypeFields() {
    const type = valueOf("wantedFieldType");
    const person = type !== "vehicle";
    ["wantedPersonOnlyAlias", "wantedPersonOnlyId"].forEach(function(id) {
      const el = $(id);
      if (el) el.style.display = person ? "" : "none";
    });
    ["wantedVehicleOnlyPlate", "wantedVehicleOnlyModel", "wantedVehicleOnlyColor"].forEach(function(id) {
      const el = $(id);
      if (el) el.style.display = person ? "none" : "";
    });
    const label = $("wantedNameLabel");
    if (label) label.innerHTML = (person ? "Name" : "Fahrzeugbezeichnung") + ' <span class="required">*</span>';
  }

  function collectFormData() {
    const type = valueOf("wantedFieldType") || "person";
    return {
      type: type,
      name: valueOf("wantedFieldName"),
      alias: valueOf("wantedFieldAlias"),
      person_id: valueOf("wantedFieldPersonId"),
      plate: valueOf("wantedFieldPlate"),
      vehicle_model: valueOf("wantedFieldVehicleModel"),
      vehicle_color: valueOf("wantedFieldVehicleColor"),
      status: valueOf("wantedFieldStatus") || "wanted",
      danger_level: valueOf("wantedFieldDanger") || "medium",
      wanted_since: valueOf("wantedFieldWantedSince"),
      captured_at: valueOf("wantedFieldCapturedAt"),
      last_seen: valueOf("wantedFieldLastSeen"),
      armed: checkedOf("wantedFieldArmed"),
      reason: valueOf("wantedFieldReason"),
      description: valueOf("wantedFieldDescription"),
      notes: valueOf("wantedFieldNotes")
    };
  }

  function validateForm(data) {
    if (!data.name) return "Name bzw. Fahrzeugbezeichnung ist ein Pflichtfeld.";
    if (!data.reason) return "Bitte eine Straftat bzw. einen Fahndungsgrund angeben.";
    if (data.type === "person" && data.plate) return "Bei Personen bitte kein Kennzeichen angeben.";
    if (data.type === "vehicle" && data.person_id) return "Bei Fahrzeugen bitte keine Reisepassnummer angeben.";
    if (data.status === "captured" && !data.captured_at) return "Bei einer gefassten Fahndung ist das Erfassungsdatum erforderlich.";
    return null;
  }

  function openCreateModal() {
    if (!state.permissions.create) {
      showModalError("Keine Berechtigung", "Du besitzt keine Berechtigung, Fahndungen zu erstellen.");
      return;
    }

    const m = modal();
    if (!m) {
      window.alert("Das globale MDT-Modal ist nicht verfügbar.");
      return;
    }

    state.modalMode = "create";
    state.modalId = null;

    m.open({
      title: "Neue Fahndung",
      subtitle: "Fahndungsregister",
      body: formHtml({ type: "person", status: "wanted", danger_level: "medium" }),
      buttons: [
        { label: "Abbrechen", variant: "secondary", onClick: function() { closeModal(); } },
        { label: "Fahndung erstellen", variant: "primary", onClick: saveModal }
      ],
      keepCancelButton: false,
      focus: false
    });

    bindFormEvents();
  }

  function openEditModal(id) {
    if (!state.permissions.edit) return;
    const row = state.data.find(item => String(item.id) === String(id));
    if (!row) return;

    const m = modal();
    if (!m) return;

    state.modalMode = "edit";
    state.modalId = row.id;

    m.open({
      title: "Fahndung bearbeiten",
      subtitle: typeLabel(row.type) + " · " + (row.name || row.id),
      body: formHtml(row),
      buttons: [
        { label: "Abbrechen", variant: "secondary", onClick: function() { closeModal(); } },
        { label: "Speichern", variant: "primary", onClick: saveModal }
      ],
      keepCancelButton: false,
      focus: false
    });

    bindFormEvents();
  }

  function bindFormEvents() {
    const type = $("wantedFieldType");
    if (type) type.addEventListener("change", applyTypeFields);
    applyTypeFields();
  }

  function getSaveButton() {
    const m = modal();
    if (!m) return null;
    const footer = m.getFooter ? m.getFooter() : null;
    if (!footer) return null;
    const buttons = footer.querySelectorAll("button");
    for (let i = buttons.length - 1; i >= 0; i--) {
      if (buttons[i].textContent.trim() !== "Schließen" && !buttons[i].disabled) return buttons[i];
    }
    return buttons.length ? buttons[buttons.length - 1] : null;
  }

  function saveModal(button) {
    const data = collectFormData();
    const error = validateForm(data);
    if (error) {
      showModalError("Eingabe prüfen", error);
      return false;
    }

    const t = token();
    if (!t) {
      showModalError("Sitzung abgelaufen", "Es ist keine gültige Sitzung mehr vorhanden.");
      return false;
    }

    const busyButton = button || state.modalButton || getSaveButton();
    state.modalButton = busyButton || null;

    if (busyButton && modal() && modal().setButtonLoading) {
      modal().setButtonLoading(busyButton, true, state.modalMode === "create" ? "Wird erstellt ..." : "Wird gespeichert ...");
    }

    const success = function() {
      closeModal();
      loadWanted(true);
    };

    const failure = function(errorObj) {
      if (busyButton && modal() && modal().setButtonLoading) {
        modal().setButtonLoading(busyButton, false, state.modalMode === "create" ? "Fahndung erstellen" : "Speichern");
      }
      showModalError("Speichern fehlgeschlagen", errorObj && errorObj.message ? errorObj.message : "Die Fahndung konnte nicht gespeichert werden.");
    };

    if (state.modalMode === "create") {
      if (!state.permissions.create) return false;
      CloudApi.run.withSuccessHandler(success).withFailureHandler(failure).createWanted(t, data);
    } else {
      if (!state.permissions.edit || !state.modalId) return false;
      CloudApi.run.withSuccessHandler(success).withFailureHandler(failure).updateWanted(t, state.modalId, data);
    }

    return true;
  }

  function openDeleteModal(id) {
    if (!state.permissions.delete) return;

    const row = state.data.find(item => String(item.id) === String(id));
    if (!row) return;

    const m = modal();
    if (!m) return;

    m.open({
      title: "Fahndung löschen",
      subtitle: typeLabel(row.type) + " · " + (row.name || row.id),
      body: '<div class="wanted-modal-error" style="margin-top:0;background:rgba(188,72,72,.08)">Diese Fahndung wird endgültig aus dem Fahndungsregister gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.</div>' +
        '<div class="wanted-detail-grid" style="margin-top:12px">' +
          '<div class="wanted-detail-card"><div class="wanted-detail-label">Eintrag</div><div class="wanted-detail-value">' + escapeHtml(row.name || "—") + '</div></div>' +
          '<div class="wanted-detail-card"><div class="wanted-detail-label">Grund</div><div class="wanted-detail-value">' + escapeHtml(row.reason || "—") + '</div></div>' +
        '</div>',
      buttons: [
        { label: "Abbrechen", variant: "secondary", onClick: function() { closeModal(); } },
        { label: "Endgültig löschen", variant: "danger", onClick: function(button) { return deleteWanted(row.id, button); } }
      ],
      keepCancelButton: false,
      focus: false
    });
  }

  function deleteWanted(id, button) {
    if (!state.permissions.delete) return false;
    const t = token();
    if (!t) {
      showModalError("Sitzung abgelaufen", "Es ist keine gültige Sitzung mehr vorhanden.");
      return false;
    }

    const busyButton = button || state.modalButton;
    if (busyButton && modal() && modal().setButtonLoading) {
      modal().setButtonLoading(busyButton, true, "Wird gelöscht ...");
    }

    CloudApi.run
      .withSuccessHandler(function() {
        closeModal();
        loadWanted(true);
      })
      .withFailureHandler(function(errorObj) {
        if (busyButton && modal() && modal().setButtonLoading) {
          modal().setButtonLoading(busyButton, false, "Endgültig löschen");
        }
        showModalError("Löschen fehlgeschlagen", errorObj && errorObj.message ? errorObj.message : "Die Fahndung konnte nicht gelöscht werden.");
      })
      .deleteWanted(t, id);

    return true;
  }

  function setup() {
    const newButton = $("wantedNewButton");
    if (newButton) newButton.addEventListener("click", openCreateModal);

    const refreshButton = $("wantedRefreshButton");
    if (refreshButton) refreshButton.addEventListener("click", function() { loadWanted(true); });

    const search = $("wantedSearch");
    if (search) search.addEventListener("input", function() { state.search = search.value; render(); });

    const typeFilter = $("wantedTypeFilter");
    if (typeFilter) typeFilter.addEventListener("change", function() { state.typeFilter = typeFilter.value; render(); });

    const statusFilter = $("wantedStatusFilter");
    if (statusFilter) statusFilter.addEventListener("change", function() { state.statusFilter = statusFilter.value; render(); });

    const clock = $("wantedClock");
    function tick() {
      if (clock) clock.textContent = new Date().toLocaleTimeString("de-DE");
    }
    tick();
    if (state.clockInterval) clearInterval(state.clockInterval);
    state.clockInterval = setInterval(tick, 1000);

    loadConfig();
  }

  function initializeWantedPage() {
    if (state.initialized) return;
    state.initialized = true;
    setup();
  }

  window.refreshWanted = function() { loadWanted(true); };
  window.addEventListener("fib-mdt:refresh-request", function (event) { if (document.getElementById("wantedActiveBody") && !(event.detail && event.detail.source === "mutation")) loadWanted(false); });
  window.addEventListener("fib-mdt:data-changed", function (event) { const modal=document.getElementById("fibGlobalModalOverlay"); if (document.getElementById("wantedActiveBody") && !(modal && modal.classList.contains("open")) && /Wanted|Fahnd|wanted/i.test(String(event.detail && event.detail.method || ""))) loadWanted(false); });
  window.initializeWantedPage = initializeWantedPage;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeWantedPage);
  } else {
    setTimeout(initializeWantedPage, 0);
  }
})();
