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
const TRADING_PAIRS = ['BTCUSDT', 'ETHUSDT'];
const FREE_ALERT_DELAY_MS = 1000; // 1 second for testing

/**
 * Main job function to run arbitrage checks
 */
const runArbitrageCheck = async () => {
  logger.info('Running arbitrage check...');

  for (const pair of TRADING_PAIRS) {
    try {
      const prices = await priceService.getAllPrices(pair);
      
      // Update latest prices global store
      latestPrices[pair] = prices;
      
      const opportunities = arbitrageEngine.findOpportunities(prices, THRESHOLD);

      for (const opportunity of opportunities) {
        const cacheKey = `${opportunity.pair}_${opportunity.buyFrom}_${opportunity.sellTo}`;

        // Check if this opportunity was already alerted recently
        if (alertCache.has(cacheKey)) {
          continue;
        }

        // Cache the opportunity
        alertCache.set(cacheKey, true);

        // Store in DB
        await db.run(
          'INSERT INTO alerts (pair, spread, buy_from, sell_to, buy_price, sell_price) VALUES (?, ?, ?, ?, ?, ?)',
          [opportunity.pair, opportunity.spread, opportunity.buyFrom, opportunity.sellTo, opportunity.buyPrice, opportunity.sellPrice]
        );

        logger.info({ pair: opportunity.pair, spread: opportunity.spread }, 'Found arbitrage opportunity');

        // Deliver alerts
        await deliverAlerts(opportunity);
      }
    } catch (error) {
      logger.error({ err: error.message, pair }, 'Error in arbitrage check loop');
    }
  }
};

/**
 * Handles delivering alerts to free and premium users/channels
 * @param {object} opportunity 
 */
const deliverAlerts = async (opportunity) => {
  logger.info({ pair: opportunity.pair, spread: opportunity.spread }, 'Delivering alerts to users/channels');
  // 1. Send real-time to PRIVATE channel (for Premium)
  if (process.env.PRIVATE_CHANNEL_ID) {
    await bot.sendAlert(process.env.PRIVATE_CHANNEL_ID, opportunity);
  }

  // 2. Send real-time to individual PREMIUM users
  try {
    const premiumUsers = await db.all("SELECT telegram_id FROM users WHERE subscription_status = 'PREMIUM'");
    for (const user of premiumUsers) {
      await bot.sendAlert(user.telegram_id, opportunity);
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Error sending real-time alerts to premium users');
  }

  // 3. Send delayed to PUBLIC channel (for Free)
  if (process.env.PUBLIC_CHANNEL_ID) {
    setTimeout(async () => {
      await bot.sendAlert(process.env.PUBLIC_CHANNEL_ID, opportunity);
    }, FREE_ALERT_DELAY_MS);
  }

  // 4. Send delayed to individual FREE users
  try {
    const freeUsers = await db.all("SELECT telegram_id FROM users WHERE subscription_status = 'FREE'");
    for (const user of freeUsers) {
      setTimeout(async () => {
        logger.info({ userId: user.telegram_id, pair: opportunity.pair }, 'Sending alert to FREE user');
        await bot.sendAlert(user.telegram_id, opportunity);
      }, FREE_ALERT_DELAY_MS);
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Error scheduling delayed alerts for free users');
  }
};

/**
 * Initializes the scheduler
 */
const initScheduler = () => {
  const cronInterval = process.env.CRON_INTERVAL || '15'; // default 15 seconds
  
  // Use node-cron to run every N seconds
  // Note: standard cron only supports minutes. For seconds, we use a different approach or a library that supports it.
  // node-cron supports seconds if you provide 6 parts.
  cron.schedule(`*/${cronInterval} * * * * *`, runArbitrageCheck);

  logger.info(`Scheduler initialized with interval: ${cronInterval} seconds`);
};

module.exports = {
  initScheduler,
  runArbitrageCheck,
  getLatestPrices: () => latestPrices
};
