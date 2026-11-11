/**
 * LSPD MDT -> Cloudflare bridge for legacy Google-Sheet modules.
 * Add this file to the EXISTING Apps Script project. Only allowlisted methods
 * can be called. The bridge validates the Cloudflare MDT session and permission,
 * then creates a short-lived temporary Apps Script session for legacy functions
 * that still use requireSession_().
 *
 * Script Property (optional if using default site): FIB_MDT_API_BASE_URL
 * Default: https://fib-mdt.pages.dev
 */
function doPost(e) {
  var temporaryToken = "";
  var properties = PropertiesService.getScriptProperties();
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var method = String(payload.method || "");
    var args = Array.isArray(payload.args) ? payload.args.slice() : [];
    var originalToken = String(args[0] || "").trim();
    if (!originalToken) throw new Error("MDT-Sitzung fehlt.");

    var requiredPermission = "";
    if (method === "getWarrants" || method === "getWarrantStatistics") requiredPermission = "warrants.view";
    if (method === "refreshWarrantsCache") requiredPermission = "warrants.manage";
    if (["getFines", "getLawyers", "getWarrants", "getWarrantStatistics", "refreshWarrantsCache"].indexOf(method) === -1) {
      throw new Error("Nicht freigegebene API-Methode: " + method);
    }

    var baseUrl = String(properties.getProperty("FIB_MDT_API_BASE_URL") || "https://fib-mdt.pages.dev").replace(/\/+$/, "");
    var sessionInfo = fibBridgePostJson_(baseUrl + "/api/auth/session-info", { args: [originalToken], token: originalToken });
    if (!sessionInfo || sessionInfo.success !== true || !sessionInfo.user || !sessionInfo.user.id) {
      throw new Error((sessionInfo && sessionInfo.message) || "MDT-Sitzung ungültig oder abgelaufen.");
    }

    var permissionInfo = fibBridgePostJson_(baseUrl + "/api/auth/permissions", { args: [originalToken], token: originalToken });
    if (!permissionInfo || permissionInfo.success === false) throw new Error((permissionInfo && permissionInfo.message) || "Berechtigungen konnten nicht geprüft werden.");
    var isMaster = permissionInfo.master === true;
    var permissions = Array.isArray(permissionInfo.permissions) ? permissionInfo.permissions : [];
    if (requiredPermission && !isMaster && permissions.indexOf("*") === -1 && permissions.indexOf(requiredPermission) === -1) {
      throw new Error("Du besitzt nicht die erforderliche Berechtigung: " + requiredPermission);
    }

    // Legacy Apps Script functions use their own SESSION_ property store. Seed a
    // unique, one-request session only after Cloudflare has verified the real token.
    temporaryToken = "BRIDGE_" + Utilities.getUuid().replace(/-/g, "");
    var user = sessionInfo.user;
    var expires = Date.parse(sessionInfo.expiresAt || "") || (Date.now() + 60 * 60 * 1000);
    var legacySession = {
      userId: String(user.id),
      username: String(user.username || ""),
      name: String(user.name || ""),
      rank: String(user.rank || ""),
      master: isMaster,
      profileImage: String(user.profileImage || user.profile_image || ""),
      profileImageFileId: "",
      createdAt: Date.now(),
      expiresAt: expires
    };
    properties.setProperty("SESSION_" + temporaryToken, JSON.stringify(legacySession));
    if (args.length) args[0] = temporaryToken;
    else args = [temporaryToken];

    var data;
    switch (method) {
      case "getFines": data = getFines.apply(null, args); break;
      case "getLawyers": data = getLawyers.apply(null, args); break;
      case "getWarrants": data = getWarrants.apply(null, args); break;
      case "getWarrantStatistics":
        var rows = getWarrants.apply(null, args) || [];
        if (!Array.isArray(rows)) rows = [];
        data = { total: rows.length, open: rows.filter(function (row) {
          var status = String(row && (row.status || row.Status) || "").toLowerCase();
          return !status || ["closed", "resolved", "cancelled", "abgeschlossen", "erledigt"].indexOf(status) === -1;
        }).length };
        break;
      case "refreshWarrantsCache":
        if (typeof refreshWarrantsCache === "function") data = refreshWarrantsCache.apply(null, args);
        else { getWarrants.apply(null, args); data = { success: true }; }
        break;
    }
    return fibBridgeJson_({ ok: true, data: data === undefined ? null : data });
  } catch (error) {
    return fibBridgeJson_({ ok: false, code: "GOOGLE_SHEETS_CALL_FAILED", message: String(error && error.message || error || "Unbekannter Fehler") });
  } finally {
    if (temporaryToken) properties.deleteProperty("SESSION_" + temporaryToken);
  }
}

function fibBridgePostJson_(url, body) {
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  var parsed;
  try { parsed = text ? JSON.parse(text) : null; }
  catch (error) { throw new Error("MDT-API lieferte ungültiges JSON (HTTP " + code + ")."); }
  if (code < 200 || code >= 300) throw new Error((parsed && parsed.message) || ("MDT-API antwortete mit HTTP " + code + "."));
  return parsed;
}

function fibBridgeJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
