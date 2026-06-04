// routes/legal.js
// Placeholder legal pages so footer links resolve. Real copy lands with the
// licence/consent work (blocked on lawyer-reviewed text).
const PAGES = {
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/license": "License",
};

export function mountLegal(app) {
  for (const [path, title] of Object.entries(PAGES)) {
    app.get(path, (req, res) => res.render("legal", { title }));
  }
}
