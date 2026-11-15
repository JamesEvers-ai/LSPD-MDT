/* LSPD MDT Phase 4 — central runtime integration layer.
   Keeps the existing CloudApi transport and page modules compatible while
   providing a consistent lifecycle contract for all dynamically mounted pages. */
(function (window, document) {
  "use strict";
  if (window.LSPDMDT && window.LSPDMDT.__phase4) return;

  const state = {
    version: "4.00",
    currentPage: null,
    mountedAt: 0,
    cleanups: new Set(),
    moduleInstances: new Map()
  };

  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  const api = {
    get version() { return state.version; },
    get currentPage() { return state.currentPage; },
    registerCleanup(fn) {
      if (typeof fn !== "function") return function () {};
      state.cleanups.add(fn);
      return function () { state.cleanups.delete(fn); };
    },
    beforePageMount(page) {
      for (const cleanup of Array.from(state.cleanups)) {
        try { cleanup(); } catch (error) { console.warn("[LSPD MDT] cleanup failed", error); }
      }
      state.cleanups.clear();
      state.currentPage = page || null;
      state.moduleInstances.clear();
      dispatch("lspd:page-will-mount", { page: state.currentPage });
    },
    afterPageMount(page, container) {
      state.currentPage = page || state.currentPage;
      state.mountedAt = Date.now();
      dispatch("lspd:page-mounted", { page: state.currentPage, container: container || null, mountedAt: state.mountedAt });
    },
    registerModule(name, instance) {
      if (!name) return;
      state.moduleInstances.set(String(name), instance || {});
      dispatch("lspd:module-ready", { name: String(name), instance: instance || {} });
    },
    notify(type, title, message, options) {
      if (window.MDT && typeof window.MDT.notify === "function") {
        window.MDT.notify({ type: type || "info", title: title || "Hinweis", message: message || "", ...(options || {}) });
      } else if (type === "error") {
        console.error(title || "LSPD MDT", message || "");
      }
    },
    getSessionToken() {
      return sessionStorage.getItem("fib_mdt_session") ||
             sessionStorage.getItem("lspd_mdt_session") || "";
    },
    getCloudApi() {
      return window.CloudApi || null;
    }
  };

  Object.defineProperty(api, "__phase4", { value: true });
  window.LSPDMDT = api;

  window.addEventListener("pagehide", function () {
    for (const cleanup of Array.from(state.cleanups)) {
      try { cleanup(); } catch (error) {}
    }
    state.cleanups.clear();
  });
})(window, document);
