// lib/sessions.js
//
// launch_tokens.central_session_id REFERENCES central_sessions(id) with no
// ON DELETE CASCADE, and foreign keys are enforced (see db/index.js). So once a
// user has launched an app, a launch_tokens row references their session and a
// bare `DELETE FROM central_sessions` raises "FOREIGN KEY constraint failed".
//
// Every code path that deletes a central session MUST go through this helper so
// the children are removed first. launch_tokens is currently the only table
// referencing central_sessions.
export function deleteCentralSession(db, sid) {
  db.prepare('DELETE FROM launch_tokens WHERE central_session_id = ?').run(sid);
  return db.prepare('DELETE FROM central_sessions WHERE id = ?').run(sid);
}

// Delete every central session for a user (admin disable / delete / "log out
// everywhere"), removing their launch_tokens children first for the same reason.
export function deleteCentralSessionsForUser(db, userId) {
  db.prepare(
    'DELETE FROM launch_tokens WHERE central_session_id IN (SELECT id FROM central_sessions WHERE user_id = ?)',
  ).run(userId);
  return db.prepare('DELETE FROM central_sessions WHERE user_id = ?').run(userId);
}
