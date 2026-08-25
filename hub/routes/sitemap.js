// routes/sitemap.js — /sitemap.xml for the public pages.
//
// A route, not a file in public/, because every <loc> must be absolute and the host
// lives in BASE_URL. A static copy could not follow it.
//
// The path list is written out, not walked off the router: a walk would publish
// /dashboard, /admin and every /company/:slug. /login is a utility page and /terms
// still renders the coming-soon stub, so neither is listed — give /terms real copy
// and it belongs here.
const PUBLIC_PATHS = ['/', '/request', '/privacy', '/license'];

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildSitemap(baseUrl) {
  // BASE_URL is unvalidated (config.js takes it verbatim), so a stray trailing
  // slash would publish sprintsuite.uk//request. Trimmed here only — the same slash
  // also breaks the magic links built in routes/login.js and routes/admin.js, and
  // fixing THAT means normalising in config.js, which the CSRF allow-list reads.
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
