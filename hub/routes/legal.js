// routes/legal.js
// /license renders the Free Use Licence (views/license.eta) and /privacy renders
// the Data & Privacy Note (views/privacy.eta). /terms remains a "coming soon"
// stub until its copy is finalised (lawyer review).
const STUBS = {
  "/terms": "Terms",
};

export function mountLegal(app) {
  for (const [path, title] of Object.entries(STUBS)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
  app.get("/license", (req, res) => res.render("license"));
  app.get("/privacy", (req, res) => res.render("privacy"));
}
