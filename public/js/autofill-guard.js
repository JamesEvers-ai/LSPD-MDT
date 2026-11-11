/* LSPD MDT – Autofill guard (Chromium/Opera GX hardened)
 * Saved login credentials should only target the explicit login form.
 * Opera GX may ignore autocomplete="off", so modal forms also receive
 * decoy credential fields before the actual content fields.
 */
(function () {
  "use strict";
  const AUTH = new Map([
    ["username", "username"], ["password", "current-password"],
    ["registrationUsername", "username"], ["registrationPassword", "new-password"],
    ["registrationPasswordConfirm", "new-password"],
    ["profileCurrentPassword", "current-password"], ["profileNewPassword", "new-password"],
    ["profileConfirmPassword", "new-password"], ["createUserPassword", "new-password"]
  ]);
  const AUTH_FORM_IDS = new Set(["loginForm", "registrationForm"]);
  function isEntry(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.matches(".fib-autofill-decoy")) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) return ["text","search","email","tel","url","password","number"].includes((el.type || "text").toLowerCase());
    return el.isContentEditable;
  }
  function protect(el) {
    if (!isEntry(el)) return;
    const id = el.id || "";
    const form = el.closest("form");
    const isRealAuthField = AUTH.has(id) && (id === "username" || id === "password" || id.startsWith("registration") || id.startsWith("profile") || id === "createUserPassword");
    if (isRealAuthField) {
      el.setAttribute("autocomplete", AUTH.get(id));
      el.removeAttribute("data-fib-autofill-protected");
    } else {
      // `new-password` is more resistant to Chromium-family username suggestions
      // than `off`, which Opera GX may ignore. Does not affect ID-based app logic.
      el.setAttribute("autocomplete", el instanceof HTMLInputElement && el.type === "password" ? "new-password" : "new-password");
      el.setAttribute("data-fib-autofill-protected", "true");
      el.setAttribute("data-lpignore", "true");
      el.setAttribute("data-1p-ignore", "true");
      el.setAttribute("data-bwignore", "true");
      el.setAttribute("data-form-type", "other");
    }
    if (el.isContentEditable) el.setAttribute("spellcheck", "false");
    if (form && !AUTH_FORM_IDS.has(form.id)) form.setAttribute("autocomplete", "off");
  }
  function addModalDecoys(modalBody) {
    if (!modalBody || modalBody.querySelector(":scope > .fib-autofill-decoy-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "fib-autofill-decoy-wrap";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText = "position:absolute!important;left:-10000px!important;top:auto!important;width:1px!important;height:1px!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;";
    const user = document.createElement("input");
    user.className = "fib-autofill-decoy"; user.type = "text"; user.name = "fib_saved_username_decoy";
    user.autocomplete = "username"; user.tabIndex = -1; user.setAttribute("aria-hidden", "true");
    const pass = document.createElement("input");
    pass.className = "fib-autofill-decoy"; pass.type = "password"; pass.name = "fib_saved_password_decoy";
    pass.autocomplete = "current-password"; pass.tabIndex = -1; pass.setAttribute("aria-hidden", "true");
    wrap.append(user, pass);
    modalBody.insertBefore(wrap, modalBody.firstChild);
  }
  function scan(root) {
    if (!root) return;
    if (root instanceof HTMLElement && isEntry(root)) protect(root);
    if (root.querySelectorAll) root.querySelectorAll("input, textarea, [contenteditable='true']").forEach(protect);
    if (root instanceof HTMLElement && root.id === "fibGlobalModalBody") addModalDecoys(root);
    else if (root.querySelector) {
      const body = root.querySelector("#fibGlobalModalBody");
      if (body) addModalDecoys(body);
    }
  }
  function init() {
    scan(document);
    const modalBody = document.getElementById("fibGlobalModalBody");
    if (modalBody) addModalDecoys(modalBody);
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    })));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
