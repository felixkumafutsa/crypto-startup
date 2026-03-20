const express = require('express');
const dns = require('dns');
const dotenv = require('dotenv');

// Force IPv4 for all network connections to fix Render/Supabase ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

const logger = require('./utils/logger');

const db = require('./database/db');
const bot = require('./bot/bot');
const scheduler = require('./services/scheduler');
const paymentService = require('./services/paymentService');
const analyticsService = require('./services/analyticsService');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
    const premiumUsers = await db.get("SELECT COUNT(*) as count FROM users WHERE tier IN ('pro', 'vip')");
    const totalAlerts = await db.get('SELECT COUNT(*) as count FROM signals');
    const totalRevenue = await db.get("SELECT SUM(amount) as sum FROM payments WHERE status = 'confirmed'");
    
    res.json({
      totalUsers: totalUsers.count,
      premiumUsers: premiumUsers.count,
      totalAlerts: totalAlerts.count,
      totalRevenue: totalRevenue?.sum || 0
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
    const alerts = await db.all('SELECT * FROM signals ORDER BY created_at DESC LIMIT 10');
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
 * Route: Subscribe to a tier
 * GET /subscribe/:tier?telegramId=123&currency=MWK
 */
app.get('/subscribe/:tier', async (req, res) => {
  const { tier } = req.params;
  const { telegramId, currency = 'MWK' } = req.query;

  if (!['pro', 'vip'].includes(tier)) {
    return res.status(400).send('Invalid tier');
  }

  if (!telegramId) {
    return res.status(400).json({ error: 'telegramId required' });
  }

  try {
    const user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found. Send /start to the bot first.' });
    }

    const checkoutUrl = await paymentService.createCheckoutSession(user, tier, currency);
    res.redirect(checkoutUrl);
  } catch (err) {
    logger.error({ err: err.message }, 'Subscription error');
    res.status(500).send('Could not initiate subscription');
  }
});

/**
 * Route: Paychangu Webhook
 * POST /webhook/paychangu
 */
app.post(
  '/webhook/paychangu',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['signature'];
    try {
      await paymentService.handleWebhook(req.body, signature);
      res.sendStatus(200);
    } catch (err) {
      logger.error({ err: err.message }, 'Paychangu webhook error');
      res.sendStatus(400);
    }
  }
);

/**
 * Route: Payment Return (Redirect from Paychangu)
 * GET /payment/return?tx_ref=...&status=...
 */
app.get('/payment/return', async (req, res) => {
  const { tx_ref, status } = req.query;

  if (status === 'failed' || status === 'cancelled') {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
          <h1 style="color: #ef4444;">Payment Not Completed</h1>
          <p>The payment was not successful. Please return to Telegram and try /upgrade again.</p>
          <a href="https://t.me/${(await bot.getMe()).username}" style="color: #3b82f6;">Back to Bot</a>
        </body>
      </html>
    `);
  }

  try {
    const updatedUser = await paymentService.activateSubscription(tx_ref);
    if (updatedUser) {
      const tier = tx_ref.split('-')[2].toUpperCase();
      const expiry = new Date(updatedUser.subscribed_until).toLocaleDateString();
      
      await bot.getBot().sendMessage(updatedUser.telegram_id, 
        `✅ Payment confirmed! Your ${tier} subscription is now active until ${expiry}.\n` +
        `Use /status to see your account details.`
      );

      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
            <h1 style="color: #22c55e;">Payment Successful!</h1>
            <p>Your ${tier} subscription is now active. You can return to Telegram.</p>
            <a href="https://t.me/${(await bot.getMe()).username}" style="color: #3b82f6;">Back to Bot</a>
          </body>
        </html>
      `);
    } else {
      res.status(400).send('Payment verification failed or already processed.');
    }
  } catch (err) {
    logger.error({ err: err.message, tx_ref }, 'Error in payment return');
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Route: Admin Panel (Private)
 * GET /admin?token=...
 */
app.get('/admin', async (req, res) => {
  const { token } = req.query;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const stats = await db.get(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE tier = 'pro') as pro_count,
        (SELECT COUNT(*) FROM users WHERE tier = 'vip') as vip_count,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'confirmed') as total_revenue,
        (SELECT COUNT(*) FROM signals WHERE created_at > NOW() - INTERVAL '24 hours') as signals_24h
    `);

    const proUsers = await db.all("SELECT username FROM users WHERE tier = 'pro'");
    const vipUsers = await db.all("SELECT username FROM users WHERE tier = 'vip'");
    const lastPayments = await db.all(`
      SELECT p.*, u.username 
      FROM payments p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC LIMIT 20
    `);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>CryptoSpreadX Admin</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>body { font-family: 'Inter', sans-serif; }</style>
      </head>
      <body class="bg-slate-50 p-8">
        <div class="max-w-6xl mx-auto">
          <h1 class="text-3xl font-bold mb-8">System Admin Panel</h1>
          
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <p class="text-slate-500 text-sm">Total Users</p>
              <p class="text-2xl font-bold">${stats.total_users}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <p class="text-slate-500 text-sm">Active Pro/VIP</p>
              <p class="text-2xl font-bold">${parseInt(stats.pro_count) + parseInt(stats.vip_count)}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <p class="text-slate-500 text-sm">Signals (24h)</p>
              <p class="text-2xl font-bold text-blue-600">${stats.signals_24h}</p>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <p class="text-slate-500 text-sm">Total Revenue</p>
              <p class="text-2xl font-bold text-green-600">$${parseFloat(stats.total_revenue).toFixed(2)}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <h2 class="font-bold mb-4">Pro Subscribers (${stats.pro_count})</h2>
              <div class="flex flex-wrap gap-2">
                ${proUsers.map(u => `<span class="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm">@${u.username}</span>`).join('')}
              </div>
            </div>
            <div class="bg-white p-6 rounded-xl shadow-sm border">
              <h2 class="font-bold mb-4">VIP Subscribers (${stats.vip_count})</h2>
              <div class="flex flex-wrap gap-2">
                ${vipUsers.map(u => `<span class="bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-sm">@${u.username}</span>`).join('')}
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <h2 class="font-bold p-6 border-b">Recent Payments</h2>
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th class="p-4">Date</th>
                  <th class="p-4">User</th>
                  <th class="p-4">Tier</th>
                  <th class="p-4">Amount</th>
                  <th class="p-4">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                ${lastPayments.map(p => `
                  <tr>
                    <td class="p-4 text-sm">${new Date(p.created_at).toLocaleDateString()}</td>
                    <td class="p-4 font-medium">@${p.username}</td>
                    <td class="p-4 uppercase text-xs font-bold">${p.tier}</td>
                    <td class="p-4">$${parseFloat(p.amount).toFixed(2)}</td>
                    <td class="p-4">
                      <span class="px-2 py-1 rounded-full text-[10px] font-bold ${p.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">
                        ${p.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err: err.message }, 'Admin panel error');
    res.status(500).send('Internal Server Error');
  }
});

/**
 * API: Get user data for member dashboard
 * GET /api/me?telegramId=...
 */
app.get('/api/me', async (req, res) => {
  const { telegramId } = req.query;
  if (!telegramId) return res.status(400).json({ error: 'telegramId required' });

  logger.info({ telegramId }, 'Dashboard login attempt');

  try {
    // Explicitly parse to number for BIGINT column compatibility
    const tid = parseInt(telegramId);
    if (isNaN(tid)) return res.status(400).json({ error: 'Invalid Telegram ID format' });

    let user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
    
    if (!user) {
      logger.warn({ telegramId: tid }, 'User not found in database during dashboard login');
      return res.status(404).json({ error: 'User not found. Please start the bot first!' });
    }

    // Auto-upgrade for the owner ID
    const adminId = process.env.ADMIN_TELEGRAM_ID || '5480022583';
    if (tid.toString() === adminId && user.tier !== 'vip') {
      logger.info({ telegramId: tid }, 'Auto-upgrading owner to VIP');
      await db.run(
        "UPDATE users SET tier = 'vip', subscribed_until = '2036-01-01T00:00:00Z' WHERE telegram_id = ?",
        [tid]
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [tid]);
    }

    const signalCountToday = await db.get('SELECT COUNT(*) as count FROM signals WHERE created_at > NOW() - INTERVAL \'24 hours\'');
    const customAlerts = await db.all('SELECT * FROM user_alerts WHERE user_id = ?', [user.id]);
    
    // Get analytics
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
        id: user.id,
        username: user.username || `user_${telegramId}`,
        tier: user.tier || 'free',
        subscribed_until: user.subscribed_until,
        referral_code: user.referral_code,
        isAdmin: tid.toString() === adminId
      },
      stats: {
        signalsToday: parseInt(signalCountToday?.count || 0),
        totalSignals: stats.totalSignals || 0,
        avgSpread: stats.avgSpread || 0,
        estimatedROI: stats.estimatedROI || 0
      },
      alerts: customAlerts || []
    });
  } catch (error) {
    logger.error({ err: error.message, stack: error.stack, telegramId }, 'Internal error in /api/me');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * API: Get recent signals for dashboard
 * GET /api/signals/recent
 */
app.get('/api/signals/recent', async (req, res) => {
  try {
    const signals = await db.all('SELECT * FROM signals ORDER BY created_at DESC LIMIT 20');
    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

/**
 * API: Get top pairs for dashboard chart
 * GET /api/signals/top
 */
app.get('/api/signals/top', async (req, res) => {
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
 * Route: Referral redirect
 * GET /ref/:code
 */
app.get('/ref/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const referrer = await db.get('SELECT * FROM users WHERE referral_code = ?', [code]);
    if (referrer) {
      // Redirect to bot with deep link parameter
      const botUser = await bot.getMe();
      res.redirect(`https://t.me/${botUser.username}?start=${code}`);
    } else {
      res.redirect('/');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Referral redirect error');
    res.redirect('/');
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

    // 4. PayChangu mode log
    const mode = process.env.PAYCHANGU_SECRET_KEY?.startsWith('SEC-TEST') ? 'TEST' : 'LIVE';
    logger.info(`PayChangu running in ${mode} mode`);

    // 5. Start Express server
    app.listen(PORT, () => {
      logger.info(`Admin server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error({ err: error.message }, 'Failed to start application');
    process.exit(1);
  }
};

startApp();
