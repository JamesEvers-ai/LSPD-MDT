/**
 * Server-to-server bridge for the three legacy Google-Sheet modules.
 * These modules stay live against their original Sheets and are not mirrored to Supabase.
 */
export const SHEET_BACKED_METHODS = new Set([
  "getFines", "getLawyers", "getWarrants", "getWarrantStatistics", "refreshWarrantsCache"
]);

export async function googleSheetsCall(env, method, args = []) {
  const endpoint = String(env.GOOGLE_SHEETS_API_URL || "").trim();
  if (!endpoint) throw Object.assign(new Error("Die Google-Sheets-API ist nicht konfiguriert. In Cloudflare muss GOOGLE_SHEETS_API_URL auf die Web-App-URL der Apps-Script-Bridge zeigen."), { status: 503, code: "GOOGLE_SHEETS_NOT_CONFIGURED" });
  let response;
  try {
    response = await fetch(endpoint, { method: "POST", redirect: "follow", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ method, args }) });
  } catch (error) {
    throw Object.assign(new Error(`Google Sheets konnte nicht erreicht werden: ${error?.message || "Netzwerkfehler"}`), { status: 502, code: "GOOGLE_SHEETS_UNREACHABLE" });
  }
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : null; }
  catch { throw Object.assign(new Error("Google Sheets lieferte keine gültige JSON-Antwort."), { status: 502, code: "GOOGLE_SHEETS_INVALID_RESPONSE" }); }
  if (!response.ok) throw Object.assign(new Error(payload?.message || `Google Sheets antwortete mit HTTP ${response.status}.`), { status: 502, code: "GOOGLE_SHEETS_HTTP_ERROR" });
  if (!payload || payload.ok !== true) throw Object.assign(new Error(payload?.message || "Die Google-Sheets-Anfrage wurde abgelehnt."), { status: 502, code: payload?.code || "GOOGLE_SHEETS_CALL_FAILED" });
  return payload.data;
}
