(function () {
    "use strict";

    const previous = window.__FIB_MDT_PATROLS__;
    const state = previous || {
        patrolData: [],
        patrolUsers: [],
        ownPersonnelProfile: null,
        ownPersonnelProfileLoaded: false,
        ownPersonnelProfilePromise: null,
        patrolDataLoaded: false,
        patrolUsersLoaded: false,
        patrolDataPromise: null,
        patrolUsersPromise: null,
        patrolFilters: {
            group: "callsign"
        },
        initialized: false,
        instanceId: "",
        mounted: false
    };

    window.__FIB_MDT_PATROLS__ = state;
    let dutySaveQueue = Promise.resolve();

    const PATROL_PERMISSIONS = Object.freeze({
        view: "patrols.view",
        create: "patrols.create",
        edit: "patrols.edit",
        delete: "patrols.delete"
    });

    const VEHICLES = [
        "STR",
        "STR (UM)",
        "OFF",
        "OFF (UM)",
        "HSP",
        "HSP (UM)",
        "OVW"
    ];

    const DEFAULT_STATUSES = ["10-1", "10-3", "10-6", "10-23", "10-76"];
    let STATUSES = [...DEFAULT_STATUSES];
    async function loadConfiguredTenCodes() {
      try {
        const result = await window.runServer("getPatrolTenCodes");
        const values = Array.isArray(result?.codes) ? result.codes : [];
        if (values.length) STATUSES = [...new Set(values.map(v => String(typeof v === "string" ? v : (v.code || v.value || v.name || "")).trim()).filter(Boolean))];
        
      } catch (e) { console.warn("Ten-Code-Konfiguration nicht verfügbar; Standardcodes werden verwendet.", e); }
    }

    const PAGE_CACHE_MS = 30000;

    window.fibCache = window.fibCache || {};
    window.fibCache.patrols = window.fibCache.patrols || { data: null, timestamp: 0 };
    window.fibCache.patrolUsers = window.fibCache.patrolUsers || { data: null, timestamp: 0 };

    function escapeHtml(value) {
        if (typeof window.escapeDashboardHtml === "function") {
            return window.escapeDashboardHtml(value);
        }

        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getToken() {
        try {
            if (typeof sessionToken !== "undefined" && sessionToken) {
                return String(sessionToken);
            }
        } catch (error) {}

        try {
            return (
                sessionStorage.getItem("fib_mdt_session") ||
                sessionStorage.getItem("lspd_mdt_session") ||
                ""
            );
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

    function hasPatrolPermission(permission) {
        if (!permission) return true;
        if (isMasterAccount()) return true;

        try {
            if (
                typeof hasPermission === "function" &&
                hasPermission(permission)
            ) {
                return true;
            }
        } catch (error) {}

        try {
            if (
                Array.isArray(myPermissions) &&
                myPermissions.includes(permission)
            ) {
                return true;
            }
        } catch (error) {}

        return (
            Array.isArray(window.myPermissions) &&
            window.myPermissions.includes(permission)
        );
    }

    function canCreate() {
        return hasPatrolPermission(PATROL_PERMISSIONS.create);
    }

    function canEdit() {
        return hasPatrolPermission(PATROL_PERMISSIONS.edit);
    }

    function canDelete() {
        return isMasterAccount() || hasPatrolPermission(PATROL_PERMISSIONS.delete);
    }

    function currentDomInstance() {
        return (
            state.mounted &&
            state.instanceId &&
            document.getElementById("patrolsList")
        );
    }

    function systemNotify(type, title, message) {
        if (
            window.MDT &&
            MDT.notify &&
            typeof MDT.notify[type] === "function"
        ) {
            return MDT.notify[type](title, message);
        }

        return null;
    }

    function showSuccess(message) {
        return systemNotify("success", "Erfolgreich", message);
    }

    function showError(message) {
        return systemNotify(
            "error",
            "Fehler",
            message || "Die Aktion konnte nicht ausgeführt werden."
        );
    }

    function cacheValid(cache) {
        return (
            cache &&
            Array.isArray(cache.data) &&
            cache.timestamp > 0 &&
            Date.now() - cache.timestamp < PAGE_CACHE_MS
        );
    }

    function clearPatrolsCache() {
        window.fibCache.patrols.data = null;
        window.fibCache.patrols.timestamp = 0;
        state.patrolDataLoaded = false;
    }

    function clearPatrolUsersCache() {
        window.fibCache.patrolUsers.data = null;
        window.fibCache.patrolUsers.timestamp = 0;
        state.patrolUsersLoaded = false;
    }

    function getLoggedInUserId() {
        try {
            if (typeof currentUser !== "undefined" && currentUser) {
                return String(currentUser.id || currentUser.userId || currentUser.ID || "");
            }
        } catch (_) {}
        return String(window.currentUser?.id || window.currentUser?.userId || "");
    }

    function renderOwnStatus() {
        const userId = getLoggedInUserId();
        const ownPatrol = (state.patrolData || []).find(function (patrol) {
            return (patrol.members || []).some(function (member) {
                return String(member.id || member.userId || "") === userId;
            });
        });
        const profile = state.ownPersonnelProfile || {};
        const ownCallSign = String(profile.callSign || "").trim();
        const inPatrol = Boolean(ownPatrol);
        // The top-right strip is a duty overview, not a radio-code display:
        // show the selected activity as Status and the selected operational area
        // as Einsatzort. The database `status` (e.g. 10-01) and callsign/number
        // belong to the patrol record and must not be placed in these fields.
        const statusText = inPatrol
            ? String(ownPatrol.activity || "Tätigkeit nicht hinterlegt")
            : (profile.personnelStatus ? String(profile.personnelStatus) : "Nicht in Streife");
        const unitText = inPatrol
            ? String(ownPatrol.location || "Einsatzort nicht hinterlegt")
            : "Kein Einsatzort";
        if (typeof window.fibUpdateOwnStatus === "function") {
            window.fibUpdateOwnStatus({
                callSign: ownCallSign || "Kein Funkrufname hinterlegt",
                status: statusText,
                unit: unitText,
                inPatrol: inPatrol
            });
        }
    }

    function restoreOwnDutyPicker() {
      // Do not publish an off-duty state while the patrol request is still in flight.
      // Profile and patrol data load independently; the old implementation could
      // briefly overwrite a valid local/server selection with an empty state.
      if (!state.patrolDataLoaded || !Array.isArray(state.patrolData) || !state.ownPersonnelProfile) return;
      const profile = state.ownPersonnelProfile || {};
      const ownId = String(profile.userId || profile.user_id || profile.id || getLoggedInUserId() || "");
      if (!ownId) return;
      const ownPatrol = state.patrolData.find(p => (p.members || []).some(m =>
        String(m.id || m.user_id || m.userId || m.userID || "") === ownId
      ));
      if (ownPatrol) {
        window.dispatchEvent(new CustomEvent("fib-mdt:duty-state-restored", {detail: {
          inDuty: true,
          location: String(ownPatrol.location || ""),
          activity: String(ownPatrol.activity || ""),
          vehicleType: String(ownPatrol.vehicleType || ownPatrol.vehicle_type || ""),
          tenCode: String(ownPatrol.tenCode || ownPatrol.ten_code || ownPatrol.status || "10-1")
        }}));
      } else {
        window.dispatchEvent(new CustomEvent("fib-mdt:duty-state-restored", {detail: {inDuty: false}}));
      }
    }

    function fetchOwnPersonnelProfile(forceReload) {
        if (state.ownPersonnelProfileLoaded && !forceReload) {
            renderOwnStatus();
            return Promise.resolve(state.ownPersonnelProfile);
        }
        if (state.ownPersonnelProfilePromise && !forceReload) return state.ownPersonnelProfilePromise;
        state.ownPersonnelProfilePromise = new Promise(function (resolve, reject) {
            CloudApi.run
                .withSuccessHandler(function (profile) {
                    state.ownPersonnelProfile = profile && typeof profile === "object" ? profile : {};
                    state.ownPersonnelProfileLoaded = true;
                    state.ownPersonnelProfilePromise = null;
                    renderOwnStatus();
                    restoreOwnDutyPicker();
                    resolve(state.ownPersonnelProfile);
                })
                .withFailureHandler(function (error) {
                    state.ownPersonnelProfilePromise = null;
                    const callSignEl = document.getElementById("patrolOwnCallSign");
                    if (callSignEl) callSignEl.textContent = "Nicht verfügbar";
                    reject(error);
                })
                .getMyPersonnelProfile(getToken());
        });
        return state.ownPersonnelProfilePromise;
    }

    function updateCount() {
        const element = document.getElementById("patrolCount");
        if (!element) return;

        const count = Array.isArray(state.patrolData)
            ? state.patrolData.length
            : 0;

        element.textContent =
            count === 1 ? "1 Streife" : count + " Streifen";
    }

    function setLoading(loading) {
        const button = document.getElementById("patrolRefreshButton");
        const icon = document.getElementById("patrolRefreshIcon");

        if (button) {
            button.disabled = !!loading;
            button.classList.toggle("is-loading", !!loading);
        }

        if (icon) {
            icon.setAttribute("aria-busy", loading ? "true" : "false");
        }
    }

    function renderAccessDenied() {
        const container = document.getElementById("patrolsList");
        if (!container) return;

        container.innerHTML = `
            <div class="patrol-inline-message">
                <div>
                    <strong>Kein Zugriff auf die Leitstelle</strong>
                    Für die Leitstelle wird die Berechtigung
                    „${escapeHtml(PATROL_PERMISSIONS.view)}“ benötigt.
                </div>
            </div>
        `;
    }

    function fetchPatrols(forceReload) {
        const cache = window.fibCache.patrols;

        if (!forceReload && cacheValid(cache)) {
            state.patrolData = cache.data;
            state.patrolDataLoaded = true;
            renderPatrols();
            renderOwnStatus();
            restoreOwnDutyPicker();
            return Promise.resolve(state.patrolData);
        }

        if (state.patrolDataPromise && !forceReload) {
            return state.patrolDataPromise;
        }

        setLoading(true);

        state.patrolDataPromise = new Promise(function (resolve, reject) {
            CloudApi.run
                .withSuccessHandler(function (data) {
                    const normalized = Array.isArray(data) ? data : [];

                    state.patrolData = normalized;
                    state.patrolDataLoaded = true;
                    cache.data = normalized;
                    cache.timestamp = Date.now();

                    state.patrolDataPromise = null;
                    setLoading(false);
                    updateCount();
                    renderPatrols();
                    renderOwnStatus();
                    restoreOwnDutyPicker();
                    resolve(normalized);
                })
                .withFailureHandler(function (error) {
                    state.patrolDataPromise = null;
                    setLoading(false);

                    if (!state.patrolData.length) {
                        const container =
                            document.getElementById("patrolsList");

                        if (container) {
                            container.innerHTML = `
                                <div class="patrol-empty">
                                    <div class="patrol-empty-icon">
                                        <i class="fa-solid fa-triangle-exclamation"></i>
                                    </div>
                                    <div class="patrol-empty-title">
                                        Leitstelle konnte nicht geladen werden
                                    </div>
                                    <div class="patrol-empty-text">
                                        Bitte versuche es erneut.
                                    </div>
                                </div>
                            `;
                        }
                    }

                    showError(
                        error && error.message
                            ? error.message
                            : "Die Streifen konnten nicht geladen werden."
                    );

                    reject(error);
                })
                .getPatrols(getToken());
        });

        return state.patrolDataPromise;
    }

    function fetchPatrolUsers(forceReload) {
        const cache = window.fibCache.patrolUsers;

        if (!forceReload && cacheValid(cache)) {
            state.patrolUsers = cache.data;
            state.patrolUsersLoaded = true;
            return Promise.resolve(state.patrolUsers);
        }

        if (state.patrolUsersPromise && !forceReload) {
            return state.patrolUsersPromise;
        }

        state.patrolUsersPromise = new Promise(function (resolve, reject) {
            CloudApi.run
                .withSuccessHandler(function (data) {
                    const normalized = Array.isArray(data) ? data : [];

                    state.patrolUsers = normalized;
                    state.patrolUsersLoaded = true;
                    cache.data = normalized;
                    cache.timestamp = Date.now();
                    state.patrolUsersPromise = null;

                    resolve(normalized);
                })
                .withFailureHandler(function (error) {
                    state.patrolUsersPromise = null;
                    showError(
                        error && error.message
                            ? error.message
                            : "Die Beamten konnten nicht geladen werden."
                    );
                    reject(error);
                })
                .getPatrolEligibleUsers(getToken());
        });

        return state.patrolUsersPromise;
    }

    // Patrol display colors are intentionally fixed.
    // The former master-only color customization was removed so patrol rendering
    // no longer depends on a persisted color configuration or optional globals.

    function refreshPatrolData() {
        clearPatrolsCache();
        clearPatrolUsersCache();

        fetchOwnPersonnelProfile(true).catch(function () {});
        fetchPatrolUsers(true).catch(function () {});
        fetchPatrols(true).catch(function () {});
    }

    function renderPatrols() {
        const container = document.getElementById("patrolsList");
        if (!container) return;

        updateCount();

        const filtered = state.patrolData.slice();

        if (!filtered.length) {
            container.innerHTML = `
                <div class="patrol-empty">
                    <div class="patrol-empty-icon">
                        <i class="fa-solid fa-car-side"></i>
                    </div>
                    <div class="patrol-empty-title">Keine Streifen gefunden</div>
                    <div class="patrol-empty-text">
                        Aktuell ist keine aktive Streifeneinheit eingetragen.
                    </div>
                </div>
            `;
            return;
        }

        const groups = Object.create(null);

        filtered.forEach(function (patrol) {
            const leadMember = (patrol.members || []).find(function (member) {
                return String(member.position || "").toLowerCase() === "lead";
            }) || (patrol.members || [])[0];
            const callsign = String(
                leadMember?.callSign || patrol.callsign || "Unbekannt"
            ).trim() || "Unbekannt";
            const status = String(
                patrol.tenCode || patrol.ten_code || patrol.status || "Unbekannt"
            ).trim() || "Unbekannt";
            const group = state.patrolFilters.group === "callsign" ? callsign : status;

            if (!groups[group]) groups[group] = [];
            groups[group].push(patrol);
        });

        container.innerHTML = "";

        Object.keys(groups)
            .sort()
            .forEach(function (groupName) {
                const group = document.createElement("div");
                group.className = "patrol-group";

                group.innerHTML = `
                    <div class="patrol-group-title">
                        ${escapeHtml(groupName)}
                        <span class="patrol-group-count">
                            ${groups[groupName].length}
                        </span>
                    </div>
                `;

                groups[groupName].forEach(function (patrol) {
                    group.appendChild(createPatrolCard(patrol));
                });

                container.appendChild(group);
            });
    }

    function abbreviateRank(rank) {
        const value = String(rank || "").trim();
        if (!value) return "—";
        const words = value.split(/\s+/).filter(Boolean);
        return words.length > 1 ? words.map(function (word) { return word[0].toUpperCase(); }).join("") : value;
    }

    function shortAgentName(name) {
        const value = String(name || "Unbekannt").trim();
        const parts = value.split(/\s+/).filter(Boolean);
        if (parts.length < 2) return value;
        return parts[0].charAt(0).toUpperCase() + ". " + parts.slice(1).join(" ");
    }

    function createPatrolCard(patrol) {
        const card = document.createElement("div");
        card.className = "patrol-card";

        const statusValue = String(
            patrol.tenCode || patrol.ten_code || patrol.status || "Unbekannt"
        ).trim() || "Unbekannt";
        const statusClass = statusValue
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");

        const members = Array.isArray(patrol.members) ? patrol.members : [];
        const leadMember = members.find(function (member) {
            return String(member.position || "").toLowerCase() === "lead";
        }) || members[0];

        // The authoritative callsign is the one stored in the personnel file.
        // getPatrols() already resolves it for the lead member; patrol.callsign is
        // kept only as a backwards-compatible fallback for older patrol rows.
        const patrolCallsign = String(
            leadMember?.callSign || patrol.callsign || "Unbekannt"
        ).trim() || "Unbekannt";
        const patrolNumber = String(patrol.number || "").trim();
        const patrolLocation = String(patrol.location || "").trim();
        const patrolActivity = String(patrol.activity || "").trim();
        const vehicle = String(patrol.vehicleType || patrol.vehicle_type || "—").trim() || "—";

        const splitCallsign = patrolCallsign.match(/^(.+?)[- ]?(\d{1,3})$/);
        const displayCallsign = splitCallsign ? splitCallsign[1].trim() : patrolCallsign;
        const explicitNumber = /^\d{1,3}[A-Z]?$/i.test(patrolNumber) ? patrolNumber : "";
        const displayNumber = explicitNumber || (splitCallsign ? splitCallsign[2] : "");

        const membersHtml = members.length
            ? members.map(function (member) {
                const memberName = String(member.name || "Unbekannt").trim();
                const rank = String(member.rankShortName || member.rank || "—").trim();
                const memberCallsign = String(member.callSign || "").trim();
                return `
                    <div class="patrol-member" title="${escapeHtml(memberName)}${memberCallsign ? " · " + escapeHtml(memberCallsign) : ""}">
                        <span class="patrol-member-rank">${escapeHtml(rank)}</span>
                        <span class="patrol-member-name">${escapeHtml(memberName)}</span>
                        ${memberCallsign ? `<span class="patrol-member-callsign">${escapeHtml(memberCallsign)}</span>` : ""}
                    </div>
                `;
            }).join("")
            : `<div class="patrol-member patrol-member-empty">Keine Besatzung</div>`;

        const actionAllowed = canEdit() || canDelete();
        const currentUserId = String(state.currentUserId || window.currentUser?.id || "");
        const alreadyMember = members.some(function (member) {
            return String(member.id || member.user_id || "") === currentUserId;
        });

        card.innerHTML = `
            <div class="patrol-callsign" title="Funkrufname aus der Personalakte">
                <span class="patrol-callsign-type">${escapeHtml(displayCallsign)}</span>
                ${displayNumber ? `<span class="patrol-callsign-number">${escapeHtml(displayNumber)}</span>` : ""}
            </div>

            <div class="patrol-status status-${escapeHtml(statusClass)}" title="Ten Code">
                <span class="patrol-status-label">${escapeHtml(statusValue)}</span>
            </div>

            <div class="patrol-location" title="Einsatzort">
                ${escapeHtml(patrolLocation || "—")}
            </div>

            <div class="patrol-vehicle" title="Fahrzeug">
                ${escapeHtml(vehicle)}
            </div>

            <div class="patrol-activity-status${patrolActivity ? "" : " is-empty"}" title="Tätigkeit / Status">
                ${escapeHtml(patrolActivity || "—")}
            </div>

            <div class="patrol-members" title="Besatzung">
                ${membersHtml}
            </div>

            <button
                class="patrol-action-button patrol-join-button"
                type="button"
                title="${alreadyMember ? "Bereits Mitglied dieser Streife" : "Dieser Streife beitreten"}"
                aria-label="${alreadyMember ? "Bereits Mitglied dieser Streife" : "Dieser Streife beitreten"}"
                data-patrol-join="${escapeHtml(patrol.id)}"
                ${alreadyMember ? "disabled" : ""}
            >${alreadyMember ? "✓" : "+"}</button>

            ${actionAllowed ? `
                <button
                    class="patrol-action-button patrol-edit-button"
                    type="button"
                    title="Streife bearbeiten"
                    data-patrol-action="${escapeHtml(patrol.id)}"
                >
                    <i class="fa-solid fa-pen"></i>
                </button>
            ` : `<div class="patrol-no-action" aria-hidden="true"></div>`}
        `;

        const joinButton = card.querySelector("[data-patrol-join]");
        if (joinButton && !alreadyMember) {
            joinButton.addEventListener("click", function (event) {
                event.stopPropagation();
                joinButton.disabled = true;
                CloudApi.run.withSuccessHandler(function () {
                    clearPatrolsCache();
                    refreshPatrolData();
                    if (typeof window.showSuccess === "function") window.showSuccess("Du bist der Streife beigetreten.");
                }).withFailureHandler(function (error) {
                    joinButton.disabled = false;
                    if (typeof window.showError === "function") window.showError(error?.message || String(error));
                }).joinPatrol(getToken(), patrol.id);
            });
        }

        const action = card.querySelector("[data-patrol-action]");
        if (action) {
            action.addEventListener("click", function (event) {
                event.stopPropagation();
                openPatrolModal(patrol);
            });
        }

        return card;
    }

    function buildPatrolForm(patrol) {
        const editing = !!patrol;

        return `
            <div class="patrol-form-grid">
                <div class="patrol-field">
                    <label>Funkrufname aus der Personalakte</label>
                    <input
                        id="patrolModalCallsign"
                        type="text"
                        maxlength="80"
                        autocomplete="off"
                        placeholder="Wird aus dem Funkrufnamen übernommen"
                    >
                </div>

                <div class="patrol-field">
                    <label>Nummer</label>
                    <input
                        id="patrolModalNumber"
                        type="text"
                        maxlength="6"
                        placeholder="z. B. 21"
                    >
                </div>

                <div class="patrol-field">
                    <label>Fahrzeugtyp</label>
                    <select id="patrolModalVehicle">
                        ${VEHICLES.map(function (value) {
                            return `
                                <option value="${escapeHtml(value)}">
                                    ${escapeHtml(value)}
                                </option>
                            `;
                        }).join("")}
                    </select>
                </div>

                <div class="patrol-field">
                    <label>Status</label>
                    <select id="patrolModalStatus">
                        ${STATUSES.map(function (value) {
                            return `
                                <option value="${escapeHtml(value)}">
                                    ${escapeHtml(value)}
                                </option>
                            `;
                        }).join("")}
                    </select>
                </div>

                <div class="patrol-field full">
                    <div class="patrol-members-box">
                        <div class="patrol-members-header">
                            <span>Besatzung</span>
                            <button
                                type="button"
                                class="patrol-add-member"
                                id="patrolAddMember"
                            >
                                + Beamten hinzufügen
                            </button>
                        </div>

                        <div id="patrolSelectedMembers"></div>
                    </div>

                    <div
                        class="patrol-member-picker"
                        id="patrolMemberPicker"
                        style="display:none;"
                    >
                        <input
                            class="patrol-member-search"
                            id="patrolMemberSearch"
                            placeholder="Beamten suchen..."
                            type="text"
                            autocomplete="off"
                        >
                        <div id="patrolMemberOptions"></div>
                    </div>
                </div>

                <div class="patrol-field full">
                    <div id="patrolModalError" class="patrol-modal-error" style="display:none;"></div>
                </div>
            </div>
        `;
    }

    function openPatrolModal(patrol) {
        const editing = !!patrol;
        const editable = editing ? canEdit() : canCreate();

        if (!editable) {
            showError(
                editing
                    ? "Du besitzt keine Berechtigung zum Bearbeiten von Streifen."
                    : "Du besitzt keine Berechtigung zum Erstellen von Streifen."
            );
            return;
        }

        if (
            !window.FIB_MDT_MODAL ||
            typeof FIB_MDT_MODAL.open !== "function"
        ) {
            showError("Das globale Modal ist nicht verfügbar.");
            return;
        }

        let selectedMembers = (
            editing && Array.isArray(patrol.members)
                ? patrol.members
                : []
        ).map(function (member) {
            return {
                id: member.id,
                name: member.name,
                username: member.username || "",
                rank: member.rank || "Kein Rang",
                callSign: member.callSign || "",
                position: member.position === "Lead" ? "Lead" : "Member"
            };
        });

        FIB_MDT_MODAL.open({
            title: editing ? "Streife bearbeiten" : "Neue Streife",
            subtitle: "Streifeneinheit in der Leitstelle",
            body: buildPatrolForm(patrol),
            saveVisible: true,
            saveText: editing ? "Änderungen speichern" : "In Dienst gehen",
            cancelText: "Abbrechen",
            onSave: function () {
                savePatrol(patrol, selectedMembers);
            }
        });

        const callsign =
            document.getElementById("patrolModalCallsign");
        const number =
            document.getElementById("patrolModalNumber");
        const vehicle =
            document.getElementById("patrolModalVehicle");
        const status =
            document.getElementById("patrolModalStatus");
        const picker =
            document.getElementById("patrolMemberPicker");
        const search =
            document.getElementById("patrolMemberSearch");

        if (editing && patrol) {
            callsign.value = patrol.callsign || "";
            number.value = patrol.number || "";
            vehicle.value = patrol.vehicleType || VEHICLES[0];
            status.value = patrol.status || STATUSES[0];
        } else {
            callsign.value = String(state.ownPersonnelProfile?.callSign || "").trim();
            vehicle.value = VEHICLES[0];
            status.value = STATUSES[0];
        }

        function modalError(message) {
            const element = document.getElementById("patrolModalError");
            if (!element) return;
            element.style.display = "block";
            element.textContent = String(message || "");
        }

        function clearModalError() {
            const element = document.getElementById("patrolModalError");
            if (!element) return;
            element.style.display = "none";
            element.textContent = "";
        }

        function renderSelectedMembers() {
            const container =
                document.getElementById("patrolSelectedMembers");
            if (!container) return;

            if (!selectedMembers.length) {
                container.innerHTML = `
                    <div class="patrol-modal-empty">
                        Noch keine Beamten zugewiesen.
                    </div>
                `;
                return;
            }

            container.innerHTML = selectedMembers
                .map(function (member, index) {
                    return `
                        <div class="patrol-selected-member">
                            <div class="patrol-selected-information">
                                <div class="patrol-selected-rank">
                                    ${escapeHtml(member.rankShortName || member.rank || "Kein Rang")}
                                </div>
                                <div class="patrol-selected-name">
                                    ${escapeHtml(member.name || "Unbekannt")}
                                </div>
                            </div>

                            <div style="display:flex;align-items:center;gap:7px;flex:0 0 auto;">
                                <select
                                    class="patrol-member-position"
                                    data-member-position="${index}"
                                >
                                    <option
                                        value="Member"
                                        ${member.position !== "Lead" ? "selected" : ""}
                                    >
                                        Mitglied
                                    </option>
                                    <option
                                        value="Lead"
                                        ${member.position === "Lead" ? "selected" : ""}
                                    >
                                        Streifenführer
                                    </option>
                                </select>

                                <button
                                    class="patrol-remove-member"
                                    data-remove-member="${index}"
                                    type="button"
                                    title="Beamten entfernen"
                                    aria-label="Streifenpartner entfernen"
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    `;
                })
                .join("");

            container
                .querySelectorAll("[data-remove-member]")
                .forEach(function (button) {
                    button.addEventListener("click", function () {
                        const index =
                            Number(button.dataset.removeMember);

                        selectedMembers.splice(index, 1);
                        renderSelectedMembers();
                        renderMemberOptions();
                    });
                });

            container
                .querySelectorAll("[data-member-position]")
                .forEach(function (select) {
                    select.addEventListener("change", function () {
                        const index =
                            Number(select.dataset.memberPosition);

                        if (selectedMembers[index]) {
                            selectedMembers[index].position = select.value;
                            if (select.value === "Lead" && selectedMembers[index].callSign) {
                                const callsignInput = document.getElementById("patrolModalCallsign");
                                if (callsignInput) callsignInput.value = selectedMembers[index].callSign;
                            }
                            clearModalError();
                        }
                    });
                });
        }

        function renderMemberOptions() {
            const container =
                document.getElementById("patrolMemberOptions");

            if (!container) return;

            if (!state.patrolUsersLoaded) {
                container.innerHTML = `
                    <div class="patrol-modal-empty">
                        Beamte werden geladen...
                    </div>
                `;
                return;
            }

            const query =
                String(search ? search.value : "")
                    .trim()
                    .toLowerCase();

            const selectedIds = selectedMembers.map(function (member) {
                return String(member.id);
            });

            const available = state.patrolUsers
                .filter(function (user) {
                    return !selectedIds.includes(String(user.id));
                })
                .filter(function (user) {
                    if (!query) return true;

                    const haystack = [
                        user.name,
                        user.username,
                        user.rank
                    ]
                        .map(function (value) {
                            return String(value || "").toLowerCase();
                        })
                        .join(" ");

                    return haystack.includes(query);
                });

            if (!available.length) {
                container.innerHTML = `
                    <div class="patrol-modal-empty">
                        Keine passenden Beamten gefunden.
                    </div>
                `;
                return;
            }

            container.innerHTML = available
                .map(function (user) {
                    return `
                        <button
                            class="patrol-user-option"
                            data-user-id="${escapeHtml(user.id)}"
                            type="button"
                        >
                            <div class="patrol-user-option-info">
                                <div class="patrol-user-option-rank">
                                    ${escapeHtml(user.rank || "Kein Rang")}
                                </div>
                                <div class="patrol-user-option-name">
                                    ${escapeHtml(user.name || "Unbekannt")}
                                </div>
                            </div>
                            <div style="font-size:9px;color:#687588;">
                                Hinzufügen
                            </div>
                        </button>
                    `;
                })
                .join("");

            container
                .querySelectorAll("[data-user-id]")
                .forEach(function (button) {
                    button.addEventListener("click", function () {
                        const user = state.patrolUsers.find(function (item) {
                            return String(item.id) ===
                                String(button.dataset.userId);
                        });

                        if (!user) return;

                        if (
                            selectedMembers.some(function (item) {
                                return String(item.id) === String(user.id);
                            })
                        ) {
                            return;
                        }

                        selectedMembers.push({
                            id: user.id,
                            name: user.name,
                            username: user.username || "",
                            rank: user.rank || "Kein Rang",
                            callSign: user.callSign || "",
                            position:
                                selectedMembers.length === 0
                                    ? "Lead"
                                    : "Member"
                        });
                        if (selectedMembers[selectedMembers.length - 1].position === "Lead" && user.callSign) {
                            const callsignInput = document.getElementById("patrolModalCallsign");
                            if (callsignInput) callsignInput.value = user.callSign;
                        }

                        clearModalError();
                        renderSelectedMembers();
                        renderMemberOptions();
                    });
                });
        }

        renderSelectedMembers();
        renderMemberOptions();

        const addButton =
            document.getElementById("patrolAddMember");

        if (addButton && !addButton.dataset.bound) {
            addButton.dataset.bound = "true";
            addButton.addEventListener("click", function () {
                if (!picker) return;

                picker.style.display =
                    picker.style.display === "none"
                        ? "block"
                        : "none";

                if (picker.style.display === "block") {
                    search?.focus();
                    renderMemberOptions();
                }
            });
        }

        if (search && !search.dataset.bound) {
            search.dataset.bound = "true";
            search.addEventListener("input", renderMemberOptions);
        }

        /*
         * Die Benutzerliste kann parallel zum Modal geöffnet werden.
         * Sobald sie ankommt, wird der Picker automatisch aktualisiert.
         */
        fetchPatrolUsers(false)
            .then(function () {
                renderMemberOptions();
            })
            .catch(function (error) {});

        if (editing && canDelete()) {
            FIB_MDT_MODAL.setFooterButtons([
                {
                    label: "Streife entfernen",
                    className: "danger",
                    onClick: function () {
                        deletePatrol(patrol);
                    }
                }
            ], { keepSave: true });
        }

        clearModalError();

        return true;
    }

    function setModalBusy(busy, label) {
        const save = FIB_MDT_MODAL?.getSaveButton?.();
        const cancel = FIB_MDT_MODAL?.getCancelButton?.();

        if (save) {
            save.disabled = !!busy;
            save.textContent =
                label ||
                save.textContent ||
                "Speichern";
        }

        // Keep Cancel available even while saving. The save action alone is locked
        // to prevent duplicate submissions; users must never be trapped in a modal.
        if (cancel) {
            cancel.disabled = false;
            cancel.removeAttribute("disabled");
        }
    }

    function readPatrolModalData(selectedMembers, patrol) {
        const callsign =
            document.getElementById("patrolModalCallsign");
        const number =
            document.getElementById("patrolModalNumber");
        const vehicle =
            document.getElementById("patrolModalVehicle");
        const status =
            document.getElementById("patrolModalStatus");

        return {
            id: patrol ? patrol.id : null,
            callsign: callsign?.value?.trim() || "",
            number: number?.value?.trim() || "",
            vehicleType: vehicle?.value || "",
            status: status?.value || "",
            members: selectedMembers.map(function (member) {
                return {
                    id: member.id,
                    position: member.position === "Lead"
                        ? "Lead"
                        : "Member"
                };
            })
        };
    }

    function savePatrol(patrol, selectedMembers) {
        const editing = !!patrol;
        const form = readPatrolModalData(selectedMembers, patrol);

        if (!form.number) {
            showError("Bitte eine Streifennummer angeben.");
            return;
        }

        if (!form.callsign || !String(form.callsign).trim()) {
            showError("Bitte einen Funkrufnamen aus der Personalakte hinterlegen oder eingeben.");
            return;
        }

        if (!VEHICLES.includes(form.vehicleType)) {
            showError("Bitte einen gültigen Fahrzeugtyp auswählen.");
            return;
        }

        if (!STATUSES.includes(form.status)) {
            showError("Bitte einen gültigen Status auswählen.");
            return;
        }

        const leads = selectedMembers.filter(function (member) {
            return member.position === "Lead";
        });

        if (leads.length > 1) {
            showError("Eine Streife kann nur einen Streifenführer haben.");
            return;
        }

        setModalBusy(
            true,
            editing ? "Speichern..." : "Erstellen..."
        );

        const method = editing ? "updatePatrol" : "createPatrol";

        CloudApi.run
            .withSuccessHandler(function (result) {
                const saved = result?.patrol || result;

                if (!saved || !saved.id) {
                    FIB_MDT_MODAL.close();
                    clearPatrolsCache();
                    fetchPatrols(true).catch(function () {});
                    showSuccess(
                        editing
                            ? "Die Streife wurde aktualisiert."
                            : "Die Streife wurde erstellt."
                    );
                    return;
                }

                if (editing) {
                    const index = state.patrolData.findIndex(function (item) {
                        return String(item.id) === String(saved.id);
                    });

                    if (index >= 0) {
                        state.patrolData[index] = saved;
                    } else {
                        state.patrolData.push(saved);
                    }
                } else {
                    state.patrolData.push(saved);
                }

                window.fibCache.patrols.data = state.patrolData;
                window.fibCache.patrols.timestamp = Date.now();
                state.patrolDataLoaded = true;

                renderPatrols();
                FIB_MDT_MODAL.close();

                showSuccess(
                    editing
                        ? "Die Streife wurde aktualisiert."
                        : "Die Streife wurde erstellt."
                );
            })
            .withFailureHandler(function (error) {
                setModalBusy(
                    false,
                    editing ? "Änderungen speichern" : "In Dienst gehen"
                );

                showError(
                    error && error.message
                        ? error.message
                        : "Die Streife konnte nicht gespeichert werden."
                );
            })
            [method](getToken(), form);
    }

    async function deletePatrol(patrol) {
        if (!canDelete()) {
            showError("Du besitzt keine Berechtigung zum Entfernen von Streifen.");
            return;
        }

        const confirmed = await FIB_MDT_MODAL.confirm({
            title: "Streife entfernen",
            subtitle: "Diese Aktion kann nicht rückgängig gemacht werden.",
            message: "Möchtest du diese Streife wirklich entfernen?",
            confirmText: "Streife entfernen",
            cancelText: "Abbrechen",
            danger: true
        });
        if (!confirmed) return;

        CloudApi.run
            .withSuccessHandler(function () {
                state.patrolData = state.patrolData.filter(function (item) {
                    return String(item.id) !== String(patrol.id);
                });

                window.fibCache.patrols.data = state.patrolData;
                window.fibCache.patrols.timestamp = Date.now();
                state.patrolDataLoaded = true;

                renderPatrols();

                showSuccess("Die Streife wurde entfernt.");
            })
            .withFailureHandler(function (error) {
                showError(
                    error && error.message
                        ? error.message
                        : "Die Streife konnte nicht entfernt werden."
                );
            })
            .deletePatrol(getToken(), patrol.id);
    }

    function bindStaticEvents() {
        const createButton = document.getElementById("patrolCreateButton");
        // Duty creation now happens exclusively in the topbar picker, never in the legacy modal.
        if (createButton) createButton.style.display = "none";
        if (!window.fibDutyStartListenerBound) {
            window.fibDutyStartListenerBound = true;
            function handleDutySelection(event) {
                // Serialize rapid topbar changes. updatePatrol replaces membership rows,
                // so concurrent writes could otherwise delete a newer update.
                dutySaveQueue = dutySaveQueue.catch(function () {}).then(function () { return persistDutySelection(event); });
                return dutySaveQueue;
            }
            async function persistDutySelection(event) {
                const detail = event.detail || {};
                const isStart = event.type === "fib-mdt:duty-start-request";
                if (!detail.location || !detail.activity || !detail.vehicleType) return;
                try {
                    const profile = await fetchOwnPersonnelProfile(false);
                    const callsign = String(profile?.callSign || profile?.call_sign || "").trim();
                    if (!callsign) {
                        showError("Bitte hinterlege zuerst dein Callsign in deiner Personalakte.");
                        return;
                    }
                    const ownId = String(profile.userId || profile.user_id || profile.id || "");
                    const existing = (state.patrolData || []).find(p => (p.members || []).some(m => String(m.id || m.user_id) === ownId));
                    // Selection changes only update an existing duty entry; they must never silently start a new shift.
                    if (!isStart && !existing) return;
                    const applyButton = document.getElementById("fibDutyStartButton");
                    if (applyButton) applyButton.disabled = true;
                    const form = {
                        ...(existing ? {id: existing.id} : {}),
                        callsign: callsign,
                        number: callsign,
                        vehicleType: detail.vehicleType,
                        tenCode: detail.tenCode || existing?.tenCode || existing?.ten_code || existing?.status || (detail.activity === "OOV" ? "10-6" : "10-1"),
                        location: detail.location,
                        activity: detail.activity,
                        members: existing ? (existing.members || []).map(m => ({id: m.id || m.user_id, position: m.position || "Member"})) : []
                    };
                    const saveMethod = existing ? "updatePatrol" : "createPatrol";
                    CloudApi.run.withSuccessHandler(function (result) {
                        const saved = result?.patrol || result;
                        if (saved && saved.id) {
                            const idx = (state.patrolData || []).findIndex(p => String(p.id) === String(saved.id));
                            if (idx >= 0) state.patrolData[idx] = saved; else state.patrolData.push(saved);
                        }
                        clearPatrolsCache();
                        fetchPatrols(true).catch(function () {});
                        if (isStart) window.dispatchEvent(new CustomEvent("fib-mdt:duty-started", {detail:{...form,callSign:callsign}}));
                        else window.dispatchEvent(new CustomEvent("fib-mdt:duty-started", {detail:{...form,callSign:callsign}}));
                        if (isStart && typeof window.showSuccess === "function") window.showSuccess("Du bist jetzt im Dienst.");
                        if (applyButton) applyButton.disabled = false;
                    }).withFailureHandler(function (error) {
                        if (applyButton) applyButton.disabled = false;
                        if (typeof window.showError === "function") window.showError(error?.message || "Der Dienststatus konnte nicht gespeichert werden.");
                    })[saveMethod](getToken(), form);
                } catch (error) {
                    if (typeof window.showError === "function") window.showError(error?.message || "Dein Callsign konnte nicht aus der Personalakte geladen werden.");
                }
            }
            window.__fibPageLifecycle.on(window, "fib-mdt:duty-start-request", handleDutySelection);
            window.__fibPageLifecycle.on(window, "fib-mdt:duty-selection-changed", handleDutySelection);
            window.__fibPageLifecycle.on(window, "fib-mdt:ten-code-changed", async function(event) {
                const code = String(event.detail?.tenCode || "").trim();
                if (!code) return;
                try {
                    await fetchPatrols(true);
                    const profile = await fetchOwnPersonnelProfile(true);
                    const ownId = String(profile.userId || profile.user_id || profile.id || "");
                    const existing = (state.patrolData || []).find(p => (p.members || []).some(m => String(m.id || m.user_id) === ownId));
                    if (!existing) { showError("Du bist aktuell keiner Streife zugeordnet."); return; }
                    const result = await window.runServer("setPatrolTenCode", {id: existing.id, tenCode: code});
                    if (!result || result.success === false) throw new Error(result?.message || "Ten Code konnte nicht gespeichert werden.");
                    existing.tenCode = code; existing.ten_code = code;
                    clearPatrolsCache();
                    await fetchPatrols(true);
                    if (typeof window.showSuccess === "function") window.showSuccess("Ten Code der Streife aktualisiert.");
                } catch (error) {
                    showError(error?.message || "Ten Code konnte nicht gespeichert werden.");
                }
            });
        }

        const refreshButton =
            document.getElementById("patrolRefreshButton");

        if (refreshButton && !refreshButton.dataset.bound) {
            refreshButton.dataset.bound = "true";
            refreshButton.addEventListener("click", refreshPatrolData);
        }

        document
            .querySelectorAll(".patrol-group-button")
            .forEach(function (button) {
                if (button.dataset.bound) return;

                button.dataset.bound = "true";
                button.addEventListener("click", function () {
                    state.patrolFilters.group =
                        button.dataset.group || "status";

                    document
                        .querySelectorAll(".patrol-group-button")
                        .forEach(function (item) {
                            item.classList.remove("active");
                        });

                    button.classList.add("active");
                    renderPatrols();
                });
            });
    }

    function applyPermissionUI() {
        const createButton =
            document.getElementById("patrolCreateButton");

        if (createButton) createButton.style.display = "none";

        const description =
            document.getElementById("patrolPermissionHint");

        if (description) {
            if (isMasterAccount()) {
                description.textContent = "Masterzugriff";
            } else if (canEdit() || canDelete()) {
                description.textContent = "Verwaltung freigeschaltet";
            } else {
                description.textContent = "Nur Lesezugriff";
            }
        }
    }

    function initializePatrols() {
        state.instanceId =
            String(Date.now()) +
            "_" +
            Math.random().toString(36).slice(2);

        state.mounted = true;

        if (!hasPatrolPermission(PATROL_PERMISSIONS.view)) {
            applyPermissionUI();
            renderAccessDenied();
            state.initialized = true;
            return;
        }

        applyPermissionUI();
        loadConfiguredTenCodes().then(function(){ const select=document.getElementById("patrolModalStatus"); if(select){const selected=select.value;select.innerHTML=STATUSES.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");if(STATUSES.includes(selected))select.value=selected;} });
        bindStaticEvents();

        if (cacheValid(window.fibCache.patrols)) {
            state.patrolData = window.fibCache.patrols.data;
            state.patrolDataLoaded = true;
            renderPatrols();
        }

        if (cacheValid(window.fibCache.patrolUsers)) {
            state.patrolUsers = window.fibCache.patrolUsers.data;
            state.patrolUsersLoaded = true;
        }

        fetchOwnPersonnelProfile(false).catch(function () {});
        fetchPatrols(false).catch(function () {});
        if (canCreate() || canEdit()) {
            fetchPatrolUsers(false).catch(function () {});
        }
        renderOwnStatus();

        state.initialized = true;
    }

    window.initializePatrols = initializePatrols;
    // Cross-client modular status sync: refresh the persisted patrol snapshot regularly.
    // This makes changes saved by another Agent appear without a manual page reload.
    if (!window.fibPatrolLiveSyncTimer) {
        window.fibPatrolLiveSyncTimer = window.__fibPageLifecycle.interval(function () {
            const list = document.getElementById("patrolsList");
            const modal = document.getElementById("fibGlobalModalOverlay");
            if (list && !state.saving && !(modal && modal.classList.contains("open"))) {
                fetchPatrols(true).catch(function () {});
            }
        }, 15000);
    }
    window.__fibPageLifecycle.on(window, "fib-mdt:refresh-request", function (event) { const modal=document.getElementById("fibGlobalModalOverlay"); if (document.getElementById("patrolsList") && !state.saving && !(modal && modal.classList.contains("open"))) refreshPatrolData(); });
    window.__fibPageLifecycle.on(window, "fib-mdt:data-changed", function (event) { const modal=document.getElementById("fibGlobalModalOverlay"); if (document.getElementById("patrolsList") && !(modal && modal.classList.contains("open")) && /Patrol|patrol|Member|member/.test(String(event.detail && event.detail.method || ""))) refreshPatrolData(); });
})();
