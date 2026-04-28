const express = require('express');
const router = express.Router();

const db = require('../database/db');
const logger = require('../utils/logger');
const scheduler = require('../services/scheduler');
const analyticsService = require('../services/analyticsService');

/**
 * GET /api/prices
 * Latest live prices from the scheduler cache.
 */
router.get('/prices', (req, res) => {
  res.json(scheduler.getLatestPrices());
});

/**
 * GET /api/stats
 * Platform-wide aggregate stats.
 */
router.get('/stats', async (req, res) => {
  try {
    const totalUsers    = await db.get('SELECT COUNT(*) as count FROM users');
    const premiumUsers  = await db.get("SELECT COUNT(*) as count FROM users WHERE tier IN ('pro', 'vip')");
    const totalAlerts   = await db.get('SELECT COUNT(*) as count FROM signals');
    const totalRevenue  = await db.get("SELECT SUM(amount) as sum FROM payments WHERE status = 'confirmed'");

    res.json({
      totalUsers:    totalUsers.count,
      premiumUsers:  premiumUsers.count,
      totalAlerts:   totalAlerts.count,
      totalRevenue:  totalRevenue?.sum || 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/alerts
 * 10 most recent signals.
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await db.all('SELECT * FROM signals ORDER BY created_at DESC LIMIT 10');
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * GET /api/users
 * All users ordered by join date (admin use).
 */
router.get('/users', async (req, res) => {
  try {
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/me
 * Returns authenticated user's profile, stats, and alerts.
 * Query: ?telegramId=... or ?sessionToken=...
 */
router.get('/me', async (req, res) => {
  const { telegramId, sessionToken } = req.query;

  if (!telegramId && !sessionToken) {
    return res.status(400).json({ error: 'telegramId or sessionToken required' });
  }

  logger.info({ telegramId, sessionToken }, 'Dashboard login attempt');

  try {
    let user;
    let tid = null;

    if (sessionToken) {
      user = await db.get('SELECT * FROM users WHERE session_token = ?', [sessionToken]);
    } else {
      tid = parseInt(telegramId);
      if (isNaN(tid)) return res.status(400).json({ error: 'Invalid Telegram ID format' });
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
    }

    if (!user) {
      logger.warn({ telegramId: tid, sessionToken }, 'User not found during dashboard login');
      return res.status(404).json({ error: 'User not found. Please register or start the bot first!' });
    }

    // Auto-upgrade the owner account
    const adminId = process.env.ADMIN_TELEGRAM_ID || '5480022583';
    if (tid && tid.toString() === adminId && user.tier !== 'vip') {
      logger.info({ telegramId: tid }, 'Auto-upgrading owner to VIP');
      await db.run(
        "UPDATE users SET tier = 'vip', subscribed_until = '2036-01-01T00:00:00Z' WHERE telegram_id = ?",
        [tid]
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
    }

    const signalCountToday = await db.get(
      "SELECT COUNT(*) as count FROM signals WHERE created_at > datetime('now', '-1 day')"
    );
    const customAlerts = await db.all('SELECT * FROM user_alerts WHERE user_id = ?', [user.id]);

    let stats = { totalSignals: 0, avgSpread: 0, bestSpread: 0, estimatedROI: 0 };
    try {
      if (analyticsService && typeof analyticsService.getSignalStats === 'function') {
        stats = await analyticsService.getSignalStats(user.id);
      }
    } catch (analyticsError) {
      logger.error({ err: analyticsError.message, userId: user.id }, 'Error fetching analytics for user');
    }

    logger.info({ telegramId, username: user.username }, 'Dashboard login successful');

    res.json({
      user: {
        id:               user.id,
        username:         user.username || `user_${telegramId}`,
        tier:             user.tier || 'free',
        subscribed_until: user.subscribed_until,
        referral_code:    user.referral_code,
        isAdmin:          tid && tid.toString() === adminId,
      },
      stats: {
        signalsToday:  parseInt(signalCountToday?.count || 0),
        totalSignals:  stats.totalSignals || 0,
        avgSpread:     stats.avgSpread || 0,
        estimatedROI:  stats.estimatedROI || 0,
      },
      alerts: customAlerts || [],
    });
  } catch (error) {
    logger.error({ err: error.message, stack: error.stack, telegramId }, 'Internal error in /api/me');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/signals/recent
 * 20 most recent arbitrage signals.
 */
router.get('/signals/recent', async (req, res) => {
  try {
    const signals = await db.all('SELECT * FROM signals ORDER BY created_at DESC LIMIT 20');
    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

/**
 * GET /api/signals/top
 * Top performing pairs over the last 7 days.
 */
router.get('/signals/top', async (req, res) => {
  try {
    if (analyticsService && typeof analyticsService.getTopPairs === 'function') {
      const top = await analyticsService.getTopPairs(7);
      res.json(top);
    } else {
      res.json([]);
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Error in /api/signals/top');
    res.status(500).json({ error: 'Failed to fetch top pairs' });
  }
});

/**
 * GET /api/revenue
 * Daily revenue time-series for the admin chart.
 */
router.get('/revenue', async (req, res) => {
  const { isProduction } = require('../database/db');
  try {
    const query = isProduction
      ? `SELECT DATE_TRUNC('day', created_at) as date, SUM(amount) as revenue FROM payments WHERE status = 'confirmed' GROUP BY 1 ORDER BY 1`
      : `SELECT strftime('%Y-%m-%d', created_at) as date, SUM(amount) as revenue FROM payments WHERE status = 'confirmed' GROUP BY 1 ORDER BY 1`;
    const results = await db.all(query);

    res.json({
      labels:   results.map(r => new Date(r.date).toLocaleDateString()),
      revenues: results.map(r => r.revenue),
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Error fetching revenue data');
    res.status(500).json({ error: 'Failed to fetch revenue data' });
  }
});

module.exports = router;
