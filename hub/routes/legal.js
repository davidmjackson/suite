// routes/legal.js
// /license renders the Free Use Licence (views/license.eta) and /privacy renders
// the Data & Privacy Note (views/privacy.eta). /terms remains a "coming soon"
// stub until its copy is finalised (lawyer review).
const STUBS = {
  "/terms": "Terms",
};

export function mountLegal(app, { marketing = [] } = {}) {
  for (const [path, title] of Object.entries(STUBS)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
  app.get("/license", (req, res) => res.render("license"));
  // /privacy carries the consent bar: it hosts the withdraw control in §6, which
  // needs consent-banner.js present to do anything.
  app.get("/privacy", marketing, (req, res) => res.render("privacy"));
}
