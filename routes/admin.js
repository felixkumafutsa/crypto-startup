const express = require('express');
const router = express.Router();

const db = require('../database/db');
const logger = require('../utils/logger');
const { requireAdminToken } = require('../middleware/adminAuth');
const bot = require('../bot/bot');
const { isProduction } = require('../database/db');

/**
 * POST /admin/upgrade
 * Manually upgrade a user to PREMIUM tier.
 * Body: { telegram_id: "12345" }
 */
router.post('/upgrade', requireAdminToken, async (req, res) => {
  const { telegram_id } = req.body;

  if (!telegram_id) {
    return res.status(400).json({ success: false, error: 'telegram_id is required' });
  }

  try {
    const success = await bot.upgradeUser(telegram_id);
    if (success) {
      res.json({ success: true, message: `User ${telegram_id} upgraded to PREMIUM` });
    } else {
      res.status(404).json({ success: false, error: 'User not found or upgrade failed' });
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Error in admin upgrade');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /admin/stats
 * Returns aggregate stats (JSON). Previously rendered as inline HTML.
 */
router.get('/stats', requireAdminToken, async (req, res) => {
  try {
    const stats = await db.get(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE tier = 'pro') as pro_count,
        (SELECT COUNT(*) FROM users WHERE tier = 'vip') as vip_count,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'confirmed') as total_revenue,
        (SELECT COUNT(*) FROM signals WHERE created_at > ${isProduction ? "NOW() - INTERVAL '1 day'" : "datetime('now', '-1 day')"}) as signals_24h
    `);

    const proUsers = await db.all("SELECT username FROM users WHERE tier = 'pro'");
    const vipUsers = await db.all("SELECT username FROM users WHERE tier = 'vip'");
    const lastPayments = await db.all(`
      SELECT p.*, u.username 
      FROM payments p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC LIMIT 20
    `);

    res.json({ stats, proUsers, vipUsers, lastPayments });
  } catch (err) {
    logger.error({ err: err.message }, 'Admin stats error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /admin/users
 * Returns all users as JSON. Previously rendered as inline HTML.
 */
router.get('/users', requireAdminToken, async (req, res) => {
  try {
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (err) {
    logger.error({ err: err.message }, 'Admin users error');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /admin/users/:id/deactivate
 * Downgrade a user to the free tier.
 */
router.post('/users/:id/deactivate', requireAdminToken, async (req, res) => {
  try {
    await db.run("UPDATE users SET tier = 'free', subscribed_until = NULL WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Error deactivating user');
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

/**
 * PUT /admin/users/:id
 * Update a user's tier and subscription expiry.
 */
router.put('/users/:id', requireAdminToken, async (req, res) => {
  const { tier, subscribed_until } = req.body;
  try {
    await db.run("UPDATE users SET tier = ?, subscribed_until = ? WHERE id = ?", [tier, subscribed_until, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Error updating user');
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /admin/users/:id
 * Permanently delete a user record.
 */
router.delete('/users/:id', requireAdminToken, async (req, res) => {
  try {
    await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Error deleting user');
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /admin/settings
 * Return all settings as a key→value object.
 */
router.get('/settings', requireAdminToken, async (req, res) => {
  try {
    const settings = await db.all("SELECT * FROM settings");
    const settingsObj = {};
    settings.forEach(s => (settingsObj[s.key] = s.value));
    res.json(settingsObj);
  } catch (err) {
    logger.error({ err: err.message }, 'Error fetching settings');
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /admin/settings
 * Upsert one or more settings.
 * Body: { KEY: "value", ... }
 */
router.put('/settings', requireAdminToken, async (req, res) => {
  const settings = req.body;
  try {
    for (const [key, value] of Object.entries(settings)) {
      await db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
        [key, value]
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err.message }, 'Error updating settings');
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /admin/payments
 * Return the last 100 payments with user info.
 */
router.get('/payments', requireAdminToken, async (req, res) => {
  try {
    const payments = await db.all(`
      SELECT p.*, u.username 
      FROM payments p 
      LEFT JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC LIMIT 100
    `);
    res.json(payments);
  } catch (err) {
    logger.error({ err: err.message }, 'Error fetching payments');
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
