/**
 * Middleware: requireAdminToken
 * Validates the ?token=... query param against ADMIN_TOKEN env var.
 * Attach to any admin route to protect it uniformly.
 */
function requireAdminToken(req, res, next) {
  const { token } = req.query;
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdminToken };
