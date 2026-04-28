const express = require('express');
const dns = require('dns');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables first
dotenv.config();

// Force IPv4 — fixes Render/Supabase ENETUNREACH errors
dns.setDefaultResultOrder('ipv4first');

const logger = require('./utils/logger');
const db = require('./database/db');
const bot = require('./bot/bot');
const scheduler = require('./services/scheduler');
const paymentService = require('./services/paymentService');

// ─── Route modules ──────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const adminRoutes    = require('./routes/admin');
const apiRoutes      = require('./routes/api');
const paymentRoutes  = require('./routes/payments');
const miscRoutes     = require('./routes/misc');

// ─── App setup ──────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// CORS — allows the standalone frontend to call this API.
// Set CORS_ORIGIN in .env to your frontend domain, e.g. https://your-app.vercel.app
// Use "*" only during local development.
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Request logger
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Incoming request');
  next();
});

// ─── Mount routes ───────────────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api',        apiRoutes);
app.use('/admin',      adminRoutes);
app.use('/',           paymentRoutes);  // /subscribe/:tier, /webhook/..., /payment/return
app.use('/',           miscRoutes);     // /favicon.ico, /ref/:code

// ─── Bootstrap ──────────────────────────────────────────────────────────────
const startApp = async () => {
  try {
    logger.info('Starting CryptoSpreadX Bot...');

    await db.initDb();
    logger.info('Database initialized');

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    bot.initBot(telegramToken);
    logger.info('Telegram bot initialized');

    scheduler.initScheduler();
    logger.info('Scheduler initialized');

    const mode = process.env.PAYCHANGU_SECRET_KEY?.startsWith('SEC-TEST') ? 'TEST' : 'LIVE';
    logger.info(`PayChangu running in ${mode} mode`);

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to start application');
    process.exit(1);
  }
};

startApp();