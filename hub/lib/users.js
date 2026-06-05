// lib/users.js
//
// Many tables REFERENCE users(id) with no ON DELETE CASCADE, and foreign keys
// are enforced (see db/index.js). So a bare `DELETE FROM users` raises
// "FOREIGN KEY constraint failed" as soon as any child row still references the
// user (e.g. a company_members row). Like lib/sessions.js does for
// launch_tokens -> central_sessions, every code path that deletes a user MUST
// go through this helper, which removes/severs the children first.
//
// References to users(id) handled here:
//   central_sessions.user_id   (NOT NULL)  -> delete (via deleteCentralSessionsForUser, also clears launch_tokens)
//   company_members.user_id    (NOT NULL)  -> delete the rows
//   team_members.user_id       (NOT NULL)  -> delete the rows
//   app_entitlements.granted_by(nullable)  -> SET NULL (keep the grant, forget who granted it)
//   access_requests.reviewed_by(nullable)  -> SET NULL (keep the request history)
//   audit_events.user_id       (no FK)     -> left untouched (preserves the audit trail)
//
// Plus full cleanup (generic TEXT principal_id, not FKs, so they don't block the
// delete but would otherwise orphan): the user's own user-level entitlement and
// usage rows.
//
// Everything runs in a single transaction so a partial failure leaves no
// half-deleted state.
import { deleteCentralSessionsForUser } from "./sessions.js";

export function deleteUser(db, userId) {
  const tx = db.transaction(() => {
    deleteCentralSessionsForUser(db, userId);
    db.prepare("DELETE FROM company_members WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM team_members WHERE user_id = ?").run(userId);
    db.prepare("UPDATE app_entitlements SET granted_by = NULL WHERE granted_by = ?").run(userId);
    db.prepare("UPDATE access_requests SET reviewed_by = NULL WHERE reviewed_by = ?").run(userId);
    db.prepare("DELETE FROM app_entitlements WHERE principal_type = 'user' AND principal_id = ?").run(userId);
    db.prepare("DELETE FROM app_usage WHERE principal_type = 'user' AND principal_id = ?").run(userId);
    return db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  return tx();
}
