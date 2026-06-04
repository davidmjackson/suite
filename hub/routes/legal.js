// routes/legal.js
// /license renders the Free Use Licence (views/license.eta). /privacy and /terms
// remain "coming soon" stubs until their copy is finalised (lawyer review).
const STUBS = {
  "/privacy": "Privacy",
  "/terms": "Terms",
};

export function mountLegal(app) {
  for (const [path, title] of Object.entries(STUBS)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
  app.get("/license", (req, res) => res.render("license"));
}
