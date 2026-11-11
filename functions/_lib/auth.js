import { db } from "./supabase.js";

const SESSION_HOURS = 8;
const encoder = new TextEncoder();
const toHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
export async function sha256(text) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
export async function verifyPassword(password, salt, expected) {
  const actual = await sha256(String(salt || "") + String(password || ""));
  if (actual.length !== String(expected || "").length) return false;
  // Avoid an early-return comparison; hash values are fixed-length hexadecimal strings.
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ String(expected).charCodeAt(i);
  return mismatch === 0;
}
export async function createSession(env, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(tokenBytes);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  await db(env, "fib_mdt_sessions", {
    method: "POST",
    query: { select: "id" },
    body: { token_hash: tokenHash, user_id: userId, created_at: now.toISOString(), expires_at: expires.toISOString() },
    prefer: "return=minimal"
  });
  return { token, expiresAt: expires.toISOString() };
}
export function bearer(request, payload = {}) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : String(payload.token || "").trim();
}
export async function requireSession(env, token) {
  if (!token || token.length < 32 || token.length > 256) return null;
  const tokenHash = await sha256(token);
  const sessions = await db(env, "fib_mdt_sessions", {
    query: { select: "id,user_id,created_at,expires_at", token_hash: `eq.${tokenHash}`, limit: "1" }
  });
  const session = Array.isArray(sessions) ? sessions[0] : null;
  if (!session || !session.expires_at || Date.parse(session.expires_at) <= Date.now()) {
    if (session?.id) await db(env, "fib_mdt_sessions", { method: "DELETE", query: { id: `eq.${session.id}` }, prefer: "return=minimal" });
    return null;
  }
  const users = await db(env, "users", {
    query: { select: "id,username,name,rank,active,approved,master,profile_image", id: `eq.${session.user_id}`, limit: "1" }
  });
  const user = Array.isArray(users) ? users[0] : null;
  if (!user || user.active !== true || user.approved !== true) {
    await db(env, "fib_mdt_sessions", { method: "DELETE", query: { id: `eq.${session.id}` }, prefer: "return=minimal" });
    return null;
  }
  return { session, user };
}
export function publicUser(user) {
  return {
    id: String(user.id || ""),
    username: String(user.username || ""),
    name: String(user.name || ""),
    rank: String(user.rank || ""),
    master: user.master === true,
    profileImage: String(user.profile_image || "")
  };
}
export async function getPermissions(env, user) {
  if (user.master === true) return { master: true, permissions: ["*"] };
  const ranks = await db(env, "ranks", {
    query: { select: "id,name,short_name,level,active", name: `eq.${String(user.rank || "")}`, limit: "1" }
  });
  let rank = Array.isArray(ranks) ? ranks[0] : null;
  // Legacy rows may store the rank ID rather than its display name.
  if (!rank && user.rank) {
    const byId = await db(env, "ranks", { query: { select: "id,name,short_name,level,active", id: `eq.${String(user.rank)}`, limit: "1" } });
    rank = Array.isArray(byId) ? byId[0] : null;
  }
  if (!rank?.id) return { master: false, permissions: [] };
  const links = await db(env, "rank_permissions", { query: { select: "permission_id", rank_id: `eq.${rank.id}` } });
  const ids = (Array.isArray(links) ? links : []).map(x => x.permission_id).filter(Boolean);
  if (!ids.length) return { master: false, permissions: [] };
  const permissions = await db(env, "permissions", {
    query: { select: "key", id: `in.(${ids.join(",")})` }
  });
  return { master: false, permissions: (Array.isArray(permissions) ? permissions : []).map(p => String(p.key || "")).filter(Boolean) };
}
