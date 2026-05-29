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

  function addCompanyMember({ userId, companyId, role }) {
    if (!COMPANY_ROLES.has(role)) throw new Error("invalid_company_role");
    if (!getCompany(companyId)) throw new Error("company_not_found");
    db.prepare("INSERT INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)")
      .run(userId, companyId, role, now());
  }

  function setCompanyMemberRole({ userId, companyId, role }) {
    if (!COMPANY_ROLES.has(role)) throw new Error("invalid_company_role");
    const current = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(userId, companyId);
    if (!current) throw new Error("not_a_member");
    if (current.role === "owner" && role !== "owner" && ownerCount(companyId) <= 1) {
      throw new Error("last_owner");
    }
    db.prepare("UPDATE company_members SET role=? WHERE user_id=? AND company_id=?").run(role, userId, companyId);
  }

  const removeCompanyMember = db.transaction(({ userId, companyId }) => {
    const current = db.prepare("SELECT role FROM company_members WHERE user_id=? AND company_id=?").get(userId, companyId);
    if (!current) return;
    if (current.role === "owner" && ownerCount(companyId) <= 1) throw new Error("last_owner");
    db.prepare(`
      DELETE FROM team_members
      WHERE user_id = ? AND team_id IN (SELECT id FROM teams WHERE company_id = ?)
    `).run(userId, companyId);
    db.prepare("DELETE FROM company_members WHERE user_id=? AND company_id=?").run(userId, companyId);
  });

  function createTeam({ companyId, name }) {
    if (!getCompany(companyId)) throw new Error("company_not_found");
    const id = randomId();
    db.prepare("INSERT INTO teams (id,company_id,name,created_at) VALUES (?,?,?,?)")
      .run(id, companyId, name, now());
    return getTeam(id);
  }

  function listTeams(companyId) {
    return db.prepare("SELECT * FROM teams WHERE company_id=? ORDER BY name").all(companyId);
  }

  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    addCompanyMember, setCompanyMemberRole, removeCompanyMember,
    createTeam, listTeams,
    COMPANY_ROLES, TEAM_ROLES,
  };
}
