const cron = require('node-cron');
const NodeCache = require('node-cache');
const priceService = require('./priceService');
const arbitrageEngine = require('./arbitrageEngine');
const bot = require('../bot/bot');
const db = require('../database/db');
const logger = require('../utils/logger');

// Cache to prevent duplicate alerts (TTL: 1 minute for testing)
const alertCache = new NodeCache({ stdTTL: 60 });

// Global variable to store latest prices for the dashboard
let latestPrices = {};

// Configurable settings
const THRESHOLD = parseFloat(process.env.ARBITRAGE_THRESHOLD || '1.5');
const TRADING_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
const FREE_ALERT_DELAY_MS = 1000; // 1 second for testing

/**
 * Main job function to run arbitrage checks
 * @param {boolean} isVipOnly If true, only send to VIP users
 */
const runArbitrageCheck = async (isVipOnly = false) => {
  const threshold = parseFloat(process.env.ARBITRAGE_THRESHOLD || '1.5');
  logger.info({ threshold, isVipOnly }, 'Running arbitrage check...');

  for (const pair of TRADING_PAIRS) {
    try {
      const opportunity = await priceService.getBestOpportunity(pair);
      
      // Update latest prices for dashboard
      const allPrices = await priceService.getAllPrices(pair);
      latestPrices[pair] = allPrices;
      
      if (!opportunity) continue;

      if (opportunity.spreadPercent >= threshold) {
        const cacheKey = `${opportunity.pair}_${opportunity.buyExchange}_${opportunity.sellExchange}`;
        
        // If already sent by ANY scheduler in the last 60s (alertCache TTL), skip
        if (alertCache.has(cacheKey)) continue;
        alertCache.set(cacheKey, true);

        // Store in DB only if it's the standard scheduler to avoid duplicates
        if (!isVipOnly) {
          await db.run(
            'INSERT INTO signals (pair, spread, buy_exchange, sell_exchange, buy_price, sell_price) VALUES (?, ?, ?, ?, ?, ?)',
            [opportunity.pair, opportunity.spreadPercent, opportunity.buyExchange, opportunity.sellExchange, opportunity.buyPrice, opportunity.sellPrice]
          );
        }

        const alertObj = {
          pair: opportunity.pair,
          buyFrom: opportunity.buyExchange,
          sellTo: opportunity.sellExchange,
          buyPrice: opportunity.buyPrice,
          sellPrice: opportunity.sellPrice,
          spread: opportunity.spreadPercent,
          timestamp: opportunity.timestamp
        };

        await deliverAlerts(alertObj, isVipOnly);
      }
    } catch (error) {
      logger.error({ err: error.message, pair }, 'Error in arbitrage check loop');
    }
  }
};

/**
 * Handles delivering alerts to free and premium users/channels
 * @param {object} opportunity 
 * @param {boolean} isVipOnly
 */
const deliverAlerts = async (opportunity, isVipOnly = false) => {
  try {
    const users = await db.all("SELECT * FROM users");
    const userAlerts = await db.all("SELECT * FROM user_alerts");

    for (const user of users) {
      if (isVipOnly && user.tier !== 'vip') continue;

      const customAlert = userAlerts.find(a => a.user_id === user.id && a.pair === opportunity.pair);
      const threshold = customAlert ? parseFloat(customAlert.threshold) : parseFloat(process.env.ARBITRAGE_THRESHOLD || '1.5');

      if (user.tier === 'vip') {
        await bot.sendAlert(user.telegram_id, opportunity);
      } else if (user.tier === 'pro' && !isVipOnly) {
        if (opportunity.spread >= threshold) {
          await bot.sendAlert(user.telegram_id, opportunity);
        }
      } else if (user.tier === 'free' && !isVipOnly) {
        if (opportunity.spread >= parseFloat(process.env.ARBITRAGE_THRESHOLD || '1.5')) {
          setTimeout(async () => {
            await bot.sendAlert(user.telegram_id, opportunity);
          }, FREE_ALERT_DELAY_MS);
        }
      }
    }

    // Only send to channels if it's the standard scheduler
    if (!isVipOnly) {
      if (process.env.PRIVATE_CHANNEL_ID) {
        await bot.sendAlert(process.env.PRIVATE_CHANNEL_ID, opportunity);
      }
      if (process.env.PUBLIC_CHANNEL_ID && opportunity.spread >= parseFloat(process.env.ARBITRAGE_THRESHOLD || '1.5')) {
        setTimeout(async () => {
          await bot.sendAlert(process.env.PUBLIC_CHANNEL_ID, opportunity);
        }, FREE_ALERT_DELAY_MS);
      }
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Error in tier-based alert delivery');
  }
};

/**
 * Initializes the scheduler
 */
const initScheduler = () => {
  const cronInterval = process.env.CRON_INTERVAL || '15'; // default 15 seconds
  
  // Use node-cron to run every N seconds
  cron.schedule(`*/${cronInterval} * * * * *`, () => runArbitrageCheck(false));
  logger.info(`Scheduler initialized with interval: ${cronInterval} seconds`);

  // VIP High-Frequency Scheduler (Task 9)
  const vipInterval = process.env.VIP_CRON_INTERVAL || '60';
  cron.schedule(`*\/${vipInterval} * * * * *`, async () => {
    logger.info({ interval: vipInterval }, 'Running VIP high-frequency check...');
    // Only run if not overlapping with standard scheduler
    // For simplicity, we run it and handle deduplication via alertCache
    await runArbitrageCheck(true);
  });
  logger.info(`VIP Scheduler initialized with interval: ${vipInterval} seconds`);

  // Daily Subscription Expiry Check (Task 4c)
  cron.schedule('0 0 * * *', async () => {
    logger.info('Running daily subscription expiry check...');
    try {
      const expiredUsers = await db.all(
        "SELECT * FROM users WHERE subscribed_until < NOW() AND tier != 'free'"
      );

      for (const user of expiredUsers) {
        await db.run("UPDATE users SET tier = 'free' WHERE id = ?", [user.id]);
        
        const message = `⏰ Your ${user.tier.toUpperCase()} subscription has expired. ` +
          `Use /upgrade to renew and keep receiving premium signals.`;
        
        await bot.getBot().sendMessage(user.telegram_id, message);
        logger.info({ userId: user.id, oldTier: user.tier }, 'User subscription expired');
      }
    } catch (error) {
      logger.error({ err: error.message }, 'Error in subscription expiry check');
    }
  });
  logger.info('Daily expiry check scheduled');
};

module.exports = {
  initScheduler,
  runArbitrageCheck,
  getLatestPrices: () => latestPrices
};
