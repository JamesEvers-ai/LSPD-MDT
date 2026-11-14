
(function () {
  "use strict";

  const previousState = window.__FIB_MDT_DASHBOARD__;

  if (previousState && typeof previousState.cleanup === "function") {
    try {
      previousState.cleanup();
    } catch (error) {
      console.warn("[LSPD MDT] Dashboard-Cleanup fehlgeschlagen:", error);
    }
  }

  const DASHBOARD_PERMISSION = "dashboard.view";

  const state = previousState || {
    clockInterval: null,
    rankRequestId: 0,
    statisticsRequestId: 0,
    initialized: false,
    accessGranted: false,
    rankName: "",
    rankId: ""
  };

  window.__FIB_MDT_DASHBOARD__ = state;

  const instanceId = String(Date.now()) + "_" + Math.random().toString(36).slice(2);
  state.instanceId = instanceId;
  state.initialized = false;

  function isCurrentInstance() {
    return state.instanceId === instanceId;
  }

  function getDashboardCurrentUser() {
    try {
      if (typeof currentUser !== "undefined" && currentUser) {
        return currentUser;
      }
    } catch (error) {}

    try {
      if (window.currentUser) {
        return window.currentUser;
      }
    } catch (error) {}

    try {
      if (window.user) {
        return window.user;
      }
    } catch (error) {}

    return null;
  }

  function getDashboardSessionToken() {
    try {
      if (typeof sessionToken !== "undefined" && sessionToken) {
        return String(sessionToken);
      }
    } catch (error) {}

    try {
      if (window.sessionToken) {
        return String(window.sessionToken);
      }
    } catch (error) {}

    try {
      return String(
        sessionStorage.getItem("fib_mdt_session") ||
        sessionStorage.getItem("lspd_mdt_session") ||
        ""
      );
    } catch (error) {
      return "";
    }
  }

  function escapeDashboardHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getDashboardNavigationItem(pageId) {
    const navigation =
      typeof NAVIGATION !== "undefined" && Array.isArray(NAVIGATION)
        ? NAVIGATION
        : Array.isArray(window.NAVIGATION)
          ? window.NAVIGATION
          : [];

    for (const section of navigation) {
      if (!section || !Array.isArray(section.items)) continue;

      for (const item of section.items) {
        if (String(item?.id || "").trim() === String(pageId || "").trim()) {
          return item;
        }
      }
    }

    return null;
  }

  function dashboardIsMaster() {
    try {
      if (typeof isMaster !== "undefined" && isMaster === true) {
        return true;
      }
    } catch (error) {}

    try {
      return window.isMaster === true;
    } catch (error) {
      return false;
    }
  }

  function dashboardHasPermission(permission) {
    if (!permission) return true;
    if (dashboardIsMaster()) return true;

    try {
      if (typeof hasPermission === "function" && hasPermission(permission)) {
        return true;
      }
    } catch (error) {}

    try {
      if (Array.isArray(myPermissions) && myPermissions.includes(permission)) {
        return true;
      }
    } catch (error) {}

    try {
      if (Array.isArray(window.myPermissions) && window.myPermissions.includes(permission)) {
        return true;
      }
    } catch (error) {}

    return false;
  }

  function dashboardCanAccessPage(pageId) {
    const item = getDashboardNavigationItem(pageId);

    if (!item) {
      return false;
    }

    if (item.masterOnly && !dashboardIsMaster()) {
      return false;
    }

    if (Array.isArray(item.permissions) && item.permissions.length) {
      return item.permissions.some(function (permission) {
        return dashboardHasPermission(permission);
      });
    }

    return dashboardHasPermission(item.permission);
  }

  function hasDashboardAccess() {
    if (dashboardIsMaster()) {
      return true;
    }

    return dashboardHasPermission(DASHBOARD_PERMISSION);
  }

  function renderDashboardAccessDenied(root) {
    if (!root) {
      return;
    }

    root.innerHTML = `
      <div class="dashboard-empty" style="margin:18px 22px;">
        <div class="dashboard-empty-icon">
          <i class="fa-solid fa-lock"></i>
        </div>
        <div class="dashboard-empty-title">
          Kein Zugriff
        </div>
        <div class="dashboard-empty-text">
          Für das Dashboard ist die Berechtigung „dashboard.view“ erforderlich.
        </div>
      </div>
    `;
  }

  function getDashboardInitials(name) {
    const normalized = String(name || "").trim();

    if (!normalized) return "?";

    const parts = normalized.split(/\s+/).filter(Boolean);

    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }

    return (
      parts[0].charAt(0) +
      parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  }

  function getDashboardRankId(user) {
    if (!user) return "";

    const candidates = [
      user.rankId,
      user.RankID,
      user.RankId,
      user.rank
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? "").trim();
      if (value) return value;
    }

    return "";
  }

  function updateDashboardRank(rankName) {
    const value = String(rankName || "Kein Rang").trim() || "Kein Rang";

    const rankElement = document.getElementById("dashboardUserRank");
    const systemRankElement = document.getElementById("dashboardSystemRank");

    if (rankElement) rankElement.textContent = value;
    if (systemRankElement) systemRankElement.textContent = value;
  }

  function loadDashboardRank() {
    const user = getDashboardCurrentUser();
    const token = getDashboardSessionToken();

    if (!user) {
      updateDashboardRank("Kein Rang");
      return;
    }

    const directName = String(
      user.rankName || user.RankName || user.rank_name || ""
    ).trim();

    if (directName) {
      state.rankName = directName;
      state.rankId = getDashboardRankId(user);
      updateDashboardRank(directName);
      return;
    }

    const rankId = getDashboardRankId(user);

    if (!rankId) {
      updateDashboardRank("Kein Rang");
      return;
    }

    if (state.rankId === rankId && state.rankName) {
      updateDashboardRank(state.rankName);
      return;
    }

    if (!token || typeof CloudApi === "undefined" || !CloudApi.run) {
      updateDashboardRank("Kein Rang");
      return;
    }

    const requestId = ++state.rankRequestId;
    state.rankId = rankId;
    updateDashboardRank("Rang wird geladen...");

    CloudApi.run
      .withSuccessHandler(function (result) {
        if (!isCurrentInstance() || requestId !== state.rankRequestId) return;

        const name = String(result?.name || result?.rank?.name || "").trim();

        if (name) {
          state.rankName = name;
          updateDashboardRank(name);
        } else {
          updateDashboardRank("Kein Rang");
        }
      })
      .withFailureHandler(function () {
        if (!isCurrentInstance() || requestId !== state.rankRequestId) return;
        updateDashboardRank("Kein Rang");
      })
      .getRankById(token, rankId);
  }

  function updateDashboardUser() {
    const user = getDashboardCurrentUser();

    const nameElement = document.getElementById("dashboardUserName");
    const titleElement = document.getElementById("dashboardWelcomeTitle");
    const statusElement = document.getElementById("dashboardUserStatus");
    const avatarElement = document.getElementById("dashboardProfileAvatar");

    if (!user) {
      if (nameElement) nameElement.textContent = "Unbekannter Benutzer";
      if (titleElement) titleElement.textContent = "Willkommen";
      if (statusElement) {
        statusElement.textContent = "Nicht verfügbar";
        statusElement.classList.add("inactive");
      }
      updateDashboardRank("Kein Rang");
      return;
    }

    const userName = String(
      user.name || user.Name || user.username || user.Username || "Unbekannter Benutzer"
    ).trim();

    if (nameElement) nameElement.textContent = userName;
    if (titleElement) titleElement.textContent = "Willkommen, " + userName;

    const isActive = user.active !== false && user.Active !== false;

    if (statusElement) {
      statusElement.textContent = isActive ? "Aktiv" : "Inaktiv";
      statusElement.classList.toggle("inactive", !isActive);
    }

    if (!avatarElement) return;

    avatarElement.innerHTML = "";
    avatarElement.classList.remove("has-image");

    const profileImage = String(
      user.profileImage || user.ProfileImage || ""
    ).trim();

    if (!profileImage) {
      avatarElement.textContent = getDashboardInitials(userName);
      return;
    }

    const image = document.createElement("img");
    image.src = profileImage;
    image.alt = "Profilbild";
    image.draggable = false;

    image.addEventListener("error", function () {
      avatarElement.innerHTML = "";
      avatarElement.classList.remove("has-image");
      avatarElement.textContent = getDashboardInitials(userName);
    }, { once: true });

    avatarElement.appendChild(image);
    avatarElement.classList.add("has-image");
  }

  function updateDashboardPermissionInformation() {
    const accessElement = document.getElementById("dashboardAccessStatus");
    const masterElement = document.getElementById("dashboardMasterStatus");
    const permissionCountElement = document.getElementById("dashboardPermissionCount");

    const user = getDashboardCurrentUser();

    if (!user) {
      if (accessElement) {
        accessElement.textContent = "Nicht verfügbar";
        accessElement.classList.remove("granted");
        accessElement.classList.add("denied");
      }
      if (masterElement) {
        masterElement.textContent = "Nein";
        masterElement.classList.remove("granted");
        masterElement.classList.add("denied");
      }
      if (permissionCountElement) permissionCountElement.textContent = "0";
      updateDashboardRank("Kein Rang");
      return;
    }

    const master = dashboardIsMaster() || user.master === true || user.Master === true;

    if (accessElement) {
      accessElement.textContent = "Autorisiert";
      accessElement.classList.add("granted");
      accessElement.classList.remove("denied");
    }

    if (masterElement) {
      masterElement.textContent = master ? "Ja" : "Nein";
      masterElement.classList.toggle("granted", master);
      masterElement.classList.toggle("denied", !master);
    }

    let permissions = [];

    try {
      if (Array.isArray(myPermissions)) permissions = myPermissions;
    } catch (error) {}

    if (!permissions.length && Array.isArray(window.myPermissions)) {
      permissions = window.myPermissions;
    }

    if (permissionCountElement) {
      permissionCountElement.textContent = master ? "Master" : String(permissions.length);
    }
  }

  function updateDashboardClock() {
    const clockElement = document.getElementById("dashboardClock");
    if (!clockElement) return;

    clockElement.textContent = new Date().toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function startDashboardClock() {
    if (state.clockInterval) {
      clearInterval(state.clockInterval);
      state.clockInterval = null;
    }

    updateDashboardClock();
    state.clockInterval = setInterval(updateDashboardClock, 1000);
  }

  function setDashboardStat(id, value) {
    const element = document.getElementById(id);
    if (!element) return;

    if (value === null || value === undefined || value === "") {
      element.textContent = "—";
      return;
    }

    const numeric = Number(value);
    element.textContent = Number.isFinite(numeric) ? String(numeric) : String(value);
  }

  function renderDashboardStatistics(data) {
    if (!data || typeof data !== "object") return;

    setDashboardStat(
      "dashboardWarrantCount",
      data.warrants ?? data.activeWarrants
    );

    setDashboardStat(
      "dashboardSearchCount",
      data.searches ?? data.wanted ?? data.activeWanted
    );

    /*
     * `records` ist der neue bevorzugte Schlüssel.
     * Ältere Statistik-Endpunkte dürfen weiterhin funktionieren,
     * liefern aber bei fehlendem records-Wert bewusst kein falsches
     * Ergebnis für den Akten-Zähler.
     */
    setDashboardStat(
      "dashboardRecordCount",
      data.records ?? data.cases
    );

    setDashboardStat(
      "dashboardUserCount",
      data.users ?? data.activeUsers
    );
  }

  function loadDashboardStatistics() {
    const token = getDashboardSessionToken();

    if (!token || typeof CloudApi === "undefined" || !CloudApi.run) {
      return;
    }

    const requestId = ++state.statisticsRequestId;
    const runner = CloudApi.run;

    const success = function (data) {
      if (!isCurrentInstance() || requestId !== state.statisticsRequestId) return;
      renderDashboardStatistics(data);
    };

    const failure = function (error) {
      if (!isCurrentInstance() || requestId !== state.statisticsRequestId) return;

      console.warn(
        "[LSPD MDT] Dashboard-Statistiken konnten nicht geladen werden:",
        error
      );
    };

    /*
     * Bevorzugt einen dedizierten Dashboard-Endpunkt, falls vorhanden.
     * Danach kompatibler Fallback auf den bisherigen Statistik-Endpunkt.
     */
    try {
      if (typeof runner.getDashboardStatistics === "function") {
        runner
          .withSuccessHandler(success)
          .withFailureHandler(failure)
          .getDashboardStatistics(token);
        return;
      }
    } catch (error) {
      console.warn("[LSPD MDT] getDashboardStatistics nicht verfügbar:", error);
    }

    try {
      runner
        .withSuccessHandler(success)
        .withFailureHandler(failure)
        .getWarrantStatistics(token);
    } catch (error) {
      console.warn("[LSPD MDT] Kein Statistik-Endpunkt verfügbar:", error);
    }
  }

  function getQuickActions() {
    return [
      {
        page: "patrols",
        title: "Leitstelle",
        description: "Aktive Streifen und Einsatzübersicht"
      },
      {
        page: "officers",
        title: "Beamte",
        description: "LSPD-Beamte und Dienstinformationen"
      },
      {
        page: "records",
        title: "Akten & Berichte",
        description: "Akten, Berichte und Ermittlungsdaten"
      },
      {
        page: "warrants",
        title: "Haftbefehle",
        description: "Haftbefehle und Verfahrensdaten"
      },
      {
        page: "wanted",
        title: "Fahndung",
        description: "Aktuelle Fahndungen verwalten"
      },
      {
        page: "lawyers",
        title: "Anwaltskammer",
        description: "Verzeichnis der zugelassenen Anwälte"
      },
      {
        page: "announcements",
        title: "Bekanntmachungen",
        description: "Aktuelle Verfügungen und Mitteilungen"
      }
    ];
  }

  function buildDashboardQuickActions() {
    const container = document.getElementById("dashboardQuickActions");
    if (!container) return;

    container.innerHTML = "";

    const actions = getQuickActions().filter(function (action) {
      return dashboardCanAccessPage(action.page);
    });

    if (!actions.length) {
      container.innerHTML = `
        <div class="dashboard-empty dashboard-quick-empty">
          <div class="dashboard-empty-icon">
            <i class="fa-solid fa-lock"></i>
          </div>
          <div class="dashboard-empty-title">Keine Schnellzugriffe verfügbar</div>
          <div class="dashboard-empty-text">Für deinen aktuellen Account wurden keine zugänglichen Bereiche gefunden.</div>
        </div>
      `;
      return;
    }

    actions.forEach(function (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dashboard-quick-action";

      const item = getDashboardNavigationItem(action.page);
      const icon = item?.icon || "•";

      button.innerHTML = `
        <div class="dashboard-quick-action-icon">
          ${escapeDashboardHtml(icon)}
        </div>
        <div class="dashboard-quick-action-title">
          ${escapeDashboardHtml(action.title)}
        </div>
        <div class="dashboard-quick-action-description">
          ${escapeDashboardHtml(action.description)}
        </div>
      `;

      button.addEventListener("click", function () {
        if (!isCurrentInstance()) return;

        if (typeof navigateTo === "function") {
          navigateTo(action.page);
          return;
        }

        if (typeof window.navigateTo === "function") {
          window.navigateTo(action.page);
          return;
        }

        console.warn("[LSPD MDT] Keine globale Navigationsfunktion gefunden:", action.page);
      });

      container.appendChild(button);
    });
  }

  function initializeDashboard() {
    const root = document.getElementById("fibDashboard");

    if (!root || !isCurrentInstance()) {
      return;
    }

    /*
     * Zugriffsprüfung erfolgt VOR allen weiteren
     * Dashboard-Initialisierungen und Server-Requests.
     */
    state.accessGranted = hasDashboardAccess();

    if (!state.accessGranted) {
      if (state.clockInterval) {
        clearInterval(state.clockInterval);
        state.clockInterval = null;
      }

      state.rankRequestId += 1;
      state.statisticsRequestId += 1;
      state.initialized = true;

      renderDashboardAccessDenied(root);
      return;
    }

    updateDashboardUser();
    updateDashboardPermissionInformation();
    buildDashboardQuickActions();
    startDashboardClock();
    loadDashboardRank();
    loadDashboardStatistics();

    state.initialized = true;
  }

  state.cleanup = function () {
    state.rankRequestId += 1;
    state.statisticsRequestId += 1;

    if (state.clockInterval) {
      clearInterval(state.clockInterval);
      state.clockInterval = null;
    }

    state.initialized = false;
  };

  window.initializeDashboard = initializeDashboard;

  initializeDashboard();
})();
