// middleware/noStore.js — keeps a response out of every cache between the hub
// and the browser: the shared proxy, the disk cache, the back button.
//
// It is deliberately NOT mounted in the app shell beside the security headers.
// Those are constant on every response; this one is scoped, because the public
// pages (/, /login, /request, /license, /terms) hold nothing worth protecting
// and no-store there is a pure cost. Two ways in, one value:
//
//   setNoStore(res) — called inside requireSession and requireApiKey, so every
//     route behind them is covered and a route added later cannot miss it.
//   noStore — the middleware, for the handful of routes that carry auth
//     material without sitting behind either guard (see routes/magic.js).
//
// Both guards call it BEFORE they decide, so a refusal is uncacheable too.
// The middleware form is only ever needed on a GET: a cache may not store a
// response to a POST at all unless that response carries explicit freshness
// headers, which is why POST /auth/magic and POST /login do not mount it.
// `no-store` alone is the whole instruction; no-cache and must-revalidate say
// "keep it, revalidate it", which is a weaker claim, not an additional one.
export function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

export function noStore(_req, res, next) {
  setNoStore(res);
  next();
}
