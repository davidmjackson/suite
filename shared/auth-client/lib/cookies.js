// lib/cookies.js
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function setSessionCookie(
  res,
  { name, value, domain, secure = true, maxAgeSec = 60 * 60 * 24 * 30 },
) {
  const attrs = [`${name}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (domain) attrs.push(`Domain=${domain}`);
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res, { name, domain }) {
  const attrs = [`${name}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (domain) attrs.push(`Domain=${domain}`);
  res.setHeader('Set-Cookie', attrs.join('; '));
}

module.exports = { parseCookies, setSessionCookie, clearSessionCookie };
