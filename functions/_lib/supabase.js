export function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !key) throw new Error("SUPABASE_URL oder SUPABASE_SECRET_KEY ist in den Cloudflare-Secrets nicht konfiguriert.");
  return { url, key };
}
export async function db(env, table, { method = "GET", query = {}, body, prefer } = {}) {
  const { url, key } = config(env);
  const qs = new URLSearchParams(query).toString();
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.details || parsed?.hint || `Supabase-Fehler HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders }
  });
}
export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
export function corsHeaders() {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}
