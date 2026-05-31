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

  function addTeamMember({ userId, teamId, role }) {
    if (!TEAM_ROLES.has(role)) throw new Error("invalid_team_role");
    const team = getTeam(teamId);
    if (!team) throw new Error("team_not_found");
    const isMember = db.prepare("SELECT 1 FROM company_members WHERE user_id=? AND company_id=?")
      .get(userId, team.company_id);
    if (!isMember) throw new Error("not_company_member");
    db.prepare("INSERT INTO team_members (user_id,team_id,role,created_at) VALUES (?,?,?,?)")
      .run(userId, teamId, role, now());
  }

  function removeTeamMember({ userId, teamId }) {
    db.prepare("DELETE FROM team_members WHERE user_id=? AND team_id=?").run(userId, teamId);
  }

  function teamsForUser(userId, companyId) {
    return db.prepare(`
      SELECT t.id AS id, t.name AS name, tm.role AS role
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE tm.user_id = ? AND t.company_id = ?
      ORDER BY t.name
    `).all(userId, companyId);
  }

  function adminCompaniesForUser(userId) {
    return db.prepare(`
      SELECT c.id AS id, c.name AS name, c.slug AS slug, cm.role AS role
      FROM company_members cm
      JOIN companies c ON c.id = cm.company_id
      WHERE cm.user_id = ? AND cm.role IN ('owner','admin')
      ORDER BY c.name
    `).all(userId);
  }

  function listCompanyMembers(companyId) {
    return db.prepare(`
      SELECT u.id AS userId, u.email AS email, u.display_name AS display_name, cm.role AS role,
             EXISTS(SELECT 1 FROM audit_events ae WHERE ae.user_id = u.id AND ae.event_type = 'session_created') AS hasLoggedIn
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = ?
      ORDER BY u.email
    `).all(companyId).map((r) => ({ ...r, hasLoggedIn: !!r.hasLoggedIn }));
  }

  function listTeamMembers(teamId) {
    return db.prepare(`
      SELECT u.id AS userId, u.email AS email, u.display_name AS display_name, tm.role AS role,
             EXISTS(SELECT 1 FROM audit_events ae WHERE ae.user_id = u.id AND ae.event_type = 'session_created') AS hasLoggedIn
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY u.email
    `).all(teamId).map((r) => ({ ...r, hasLoggedIn: !!r.hasLoggedIn }));
  }

  return {
    createCompany, getCompany, getCompanyBySlug, suspendCompany, getTeam, ownerCount,
    addCompanyMember, setCompanyMemberRole, removeCompanyMember,
    createTeam, listTeams, teamsForUser,
    addTeamMember, removeTeamMember,
    adminCompaniesForUser, listCompanyMembers, listTeamMembers,
    COMPANY_ROLES, TEAM_ROLES,
  };
}
