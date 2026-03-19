const express = require('express');
const dns = require('dns');
const dotenv = require('dotenv');

// Force IPv4 for all network connections to fix Render/Supabase ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

const logger = require('./utils/logger');

const db = require('./database/db');
const bot = require('./bot/bot');
const scheduler = require('./services/scheduler');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Simple logging middleware for express
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request');
  next();
});

const PORT = process.env.PORT || 3000;

/**
 * Admin API: Upgrade user to PREMIUM
 * POST /admin/upgrade
 * Body: { "telegram_id": "12345" }
 */
app.post('/admin/upgrade', async (req, res) => {
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
 * API: Get latest prices
 */
app.get('/api/prices', (req, res) => {
  res.json(scheduler.getLatestPrices());
});

/**
 * API: Get dashboard stats
 */
app.get('/api/stats', async (req, res) => {
  try {
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const premiumUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE subscription_status = 'PREMIUM'");
    const totalAlerts = await db.get('SELECT COUNT(*) as count FROM alerts');
    
    res.json({
      totalUsers: totalUsers.count,
      premiumUsers: premiumUsers.count,
      totalAlerts: totalAlerts.count
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * API: Get recent alerts
 */
app.get('/api/alerts', async (req, res) => {
  try {
    const alerts = await db.all('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10');
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * API: Get all users
 */
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.all('SELECT * FROM users ORDER BY created_at DESC');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * Main application entry point
 */
const startApp = async () => {
  try {
    logger.info('Starting CryptoSpreadX Bot MVP...');

    // 1. Initialize Database
    await db.initDb();
    logger.info('Database initialized successfully');

    // 2. Initialize Telegram Bot
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    bot.initBot(telegramToken);

    // 3. Initialize Scheduler
    scheduler.initScheduler();

    // 4. Start Express server
    app.listen(PORT, () => {
      logger.info(`Admin server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error({ err: error.message }, 'Failed to start application');
    process.exit(1);
  }
};

startApp();
