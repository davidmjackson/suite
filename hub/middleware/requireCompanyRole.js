// middleware/requireCompanyRole.js
export function createRequireCompanyRole(db) {
  const getCompany = db.prepare("SELECT * FROM companies WHERE slug = ?");
  const getMembership = db.prepare("SELECT role FROM company_members WHERE user_id = ? AND company_id = ?");
  return (allowedRoles) => (req, res, next) => {
    const company = getCompany.get(req.params.slug);
    if (!company) {
      return res.status(404).render("error", { title: "Not found", message: "No such company." });
    }
    const m = getMembership.get(req.user.id, company.id);
    if (!m || !allowedRoles.includes(m.role)) {
      return res.status(403).render("error", { title: "Forbidden", message: "You don't have access to manage this company." });
    }
    req.company = company;
    req.companyRole = m.role;
    next();
  };
}
