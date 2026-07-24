// middleware/requireAdmin.js
export function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'Admin only.' });
  }
  next();
}
