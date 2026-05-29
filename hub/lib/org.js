// lib/org.js
import { randomId, now } from "./tokens.js";

const COMPANY_ROLES = new Set(["owner", "admin", "member"]);
const TEAM_ROLES = new Set(["lead", "member"]);

export function createOrg(db) {
  const getCompany = (id) => db.prepare("SELECT * FROM companies WHERE id = ?").get(id) || null;
  const getCompanyBySlug = (slug) => db.prepare("SELECT * FROM companies WHERE slug = ?").get(slug) || null;
  const getTeam = (id) => db.prepare("SELECT * FROM teams WHERE id = ?").get(id) || null;
  const ownerCount = (companyId) =>
    db.prepare("SELECT COUNT(*) AS n FROM company_members WHERE company_id = ? AND role = 'owner'").get(companyId).n;

  function createCompany({ name, slug }) {
    if (!name || !slug) throw new Error("name_and_slug_required");
    const id = randomId();
    db.prepare("INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?, 'active', ?)")
      .run(id, name, slug, now());
    return getCompany(id);
  }

  function suspendCompany(id) {
    db.prepare("UPDATE companies SET status = 'suspended' WHERE id = ?").run(id);
  }

  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    COMPANY_ROLES, TEAM_ROLES,
  };
}
