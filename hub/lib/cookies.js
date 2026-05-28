// lib/cookies.js
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function setSessionCookie(res, name, value, { secure = true, maxAgeSec = 60 * 60 * 24 * 30 } = {}) {
  const attrs = [
    `${name}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}
