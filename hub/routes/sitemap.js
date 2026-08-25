// routes/sitemap.js — /sitemap.xml for the public pages.
//
// A ROUTE, not a file in public/, because every <loc> must be absolute and the
// host already lives in BASE_URL — where config.js and the CSRF allow-list both
// read it. A static sitemap would be a second copy of the host that nothing could
// keep in step, and it would be wrong the moment the hub answered on another
// origin.
//
// The list is WRITTEN OUT, not walked off the router. Walking would be shorter and
// would sweep up /dashboard, /admin and every /company/:slug — handing a crawler a
// map of the authenticated surface. Adding a public page here is a deliberate act.
//
// /login is left out as a utility page with no content to index, and /terms
// because it still renders the "coming soon" stub in views/legal.eta: inviting
// Google to index a placeholder is worse than not being listed at all. Give /terms
// real copy and it belongs here.
const PUBLIC_PATHS = ['/', '/request', '/privacy', '/license'];

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSitemap(baseUrl) {
  // BASE_URL is not normalised anywhere (config.js takes it verbatim), and the rest
  // of the app happens to depend on it having no trailing slash — trustedOrigins()
  // compares it against Origin headers, which never carry one. Rather than reach
  // into config and move a value the CSRF allow-list is built from, this trims
  // locally: a stray slash in .env would otherwise publish sprintsuite.uk//request.
  const root = baseUrl.replace(/\/+$/, '');
  const urls = PUBLIC_PATHS.map((p) => `  <url><loc>${escapeXml(root + p)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function mountSitemap(app) {
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(buildSitemap(req.app.locals.config.baseUrl));
  });
}
