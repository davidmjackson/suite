// lib/access-requests.js
import { randomId, now } from "./tokens.js";

export function createAccessRequests(db) {
  function getRequest(id) {
    return db.prepare("SELECT * FROM access_requests WHERE id = ?").get(id) || null;
  }

  function createRequest({
    companyName, contactName, email,
    jobTitle = null, teamSize = null, appsInterest = null, message = null,
  }) {
    const id = randomId();
    db.prepare(`
      INSERT INTO access_requests
        (id,company_name,contact_name,email,job_title,team_size,apps_interest,message,status,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'pending', ?)
    `).run(
      id, companyName, contactName, email, jobTitle, teamSize,
      appsInterest ? JSON.stringify(appsInterest) : null, message, now(),
    );
    return getRequest(id);
  }

  function listByStatus(status) {
    return db.prepare("SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC").all(status);
  }

  function markReviewed({ id, status, reviewedBy = null, note = null, companyId = null }) {
    db.prepare(`
      UPDATE access_requests
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, company_id = ?
      WHERE id = ?
    `).run(status, reviewedBy, now(), note, companyId, id);
    return getRequest(id);
  }

  return { createRequest, getRequest, listByStatus, markReviewed };
}
