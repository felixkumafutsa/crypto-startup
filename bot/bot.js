const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');
const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');
const crypto = require('crypto');

let bot;

/**
 * Generates a unique 8-character referral code.
 * @returns {string}
 */
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex');
};

/**
 * Middleware to register user if not exists.
 * @param {Object} msg 
 * @returns {Promise<Object>} The user object
 */
const ensureUserExists = async (msg) => {
  const telegramId = msg.from.id;
  const username = msg.from.username || `user_${telegramId}`;
  const adminId = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID) : null;
  
  try {
    let user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!user) {
      const referralCode = generateReferralCode();
      const initialTier = (adminId && telegramId === adminId) ? 'vip' : 'free';
      const initialExpiry = (adminId && telegramId === adminId) ? '2036-01-01T00:00:00Z' : null;

      await db.run(
        'INSERT INTO users (telegram_id, username, tier, referral_code, subscribed_until) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [telegramId, username, initialTier, referralCode, initialExpiry]
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      logger.info({ telegramId, username, tier: initialTier }, 'New user registered');
    } else if (adminId && telegramId === adminId && user.tier !== 'vip') {
      // Auto-upgrade existing admin if not VIP
      await db.run(
        "UPDATE users SET tier = 'vip', subscribed_until = '2036-01-01T00:00:00Z' WHERE telegram_id = ?",
        [telegramId]
      );
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      logger.info({ telegramId }, 'Admin auto-upgraded to VIP');
    }
    return user;
  } catch (err) {
    logger.error({ err: err.message, telegramId }, 'Error ensuring user exists');
    throw err;
  }
};

/**
 * Initializes the Telegram Bot with subscription tiers and enhanced commands.
 * @param {string} token 
 * @returns {TelegramBot}
 */
const initBot = (token) => {
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not provided. Bot will not start.');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  // Middleware-like functionality for every message
  bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
      await ensureUserExists(msg);
    }
  });

  // Handle /start command
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const referralParam = match[1]; // Handle deep link referral
    const adminId = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID) : null;
    
    try {
      let user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [chatId]);
      
      if (!user) {
        const referralCode = generateReferralCode();
        let referredBy = null;
        
        if (referralParam) {
          const referrer = await db.get('SELECT id FROM users WHERE referral_code = ?', [referralParam]);
          if (referrer) referredBy = referrer.id;
        }

        const initialTier = (adminId && chatId === adminId) ? 'vip' : 'free';
        const initialExpiry = (adminId && chatId === adminId) ? '2036-01-01T00:00:00Z' : null;

        await db.run(
          'INSERT INTO users (telegram_id, username, tier, referral_code, referred_by, subscribed_until) VALUES (?, ?, ?, ?, ?, ?)',
          [chatId, msg.from.username || `user_${chatId}`, initialTier, referralCode, referredBy, initialExpiry]
        );
        user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [chatId]);
      } else if (adminId && chatId === adminId && user.tier !== 'vip') {
        await db.run(
          "UPDATE users SET tier = 'vip', subscribed_until = '2036-01-01T00:00:00Z' WHERE telegram_id = ?",
          [chatId]
        );
        user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [chatId]);
      }

      const welcomeMsg = `Welcome to CryptoSpreadX! 🚀\n\n` +
        `We offer 3 subscription tiers:\n` +
        `🆓 FREE: Public signals only (>1.5% spread).\n` +
        `💎 PRO: Private signals + Custom alerts + Analytics.\n` +
        `👑 VIP: Real-time signals + API Access + Priority Support.\n\n` +
        `Join our Public Channel: https://t.me/SpreadX_public\n\n` +
        `Current Status: ${user.tier.toUpperCase()}\n\n` +
        `Use /upgrade to see pricing and subscribe!`;

      bot.sendMessage(chatId, welcomeMsg, {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Upgrade Now", callback_data: "upgrade_menu" }]]
        }
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /start');
    }
  });

  // Handle /status command
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await ensureUserExists(msg);
      const expiry = user.subscribed_until ? new Date(user.subscribed_until).toLocaleDateString() : 'Never';
      
      // Simple count of signals for this user
      const signalCount = await db.get('SELECT COUNT(*) as count FROM signals WHERE created_at > NOW() - INTERVAL \'30 days\'');

      // Fetch last payment
      const lastPayment = await db.get('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [user.id]);
      
      let statusMsg = `👤 Profile: @${user.username}\n` +
        `⭐ Tier: ${user.tier.toUpperCase()} (expires ${expiry})\n` +
        `📊 Signals (30d): ${signalCount.count}`;

      if (lastPayment) {
        statusMsg += `\n💳 Last payment: ${lastPayment.amount} ${lastPayment.currency} on ${new Date(lastPayment.created_at).toLocaleDateString()} — ${lastPayment.status.toUpperCase()}`;
      }

      bot.sendMessage(chatId, statusMsg);
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /status');
    }
  });

  // Handle /setalert command
  bot.onText(/\/setalert\s+(\w+)\s+([\d.]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const pair = match[1].toUpperCase();
    const threshold = parseFloat(match[2]);

    try {
      const user = await ensureUserExists(msg);
      if (user.tier === 'free') {
        return bot.sendMessage(chatId, "⚠️ Custom alerts are for PRO and VIP users only. Use /upgrade to unlock!");
      }

      await db.run(
        'INSERT INTO user_alerts (user_id, pair, threshold) VALUES (?, ?, ?) ON CONFLICT (user_id, pair) DO UPDATE SET threshold = EXCLUDED.threshold',
        [user.id, pair, threshold]
      );

      bot.sendMessage(chatId, `✅ Alert set for ${pair} at ${threshold}% threshold.`);
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /setalert');
    }
  });

  // Handle /referral command
  bot.onText(/\/referral/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await ensureUserExists(msg);
      const botMe = await bot.getMe();
      const refLink = `https://t.me/${botMe.username}?start=${user.referral_code}`;
      const webRefLink = `${process.env.DOMAIN || 'http://localhost:3000'}/ref/${user.referral_code}`;
      
      // Count referrals
      const referrals = await db.get('SELECT COUNT(*) as count FROM users WHERE referred_by = ?', [user.id]);
      
      const referralMsg = `🤝 Referral Program\n\n` +
        `Invite friends and earn rewards!\n\n` +
        `🔗 Bot Link: ${refLink}\n` +
        `🌐 Web Link: ${webRefLink}\n\n` +
        `📊 Your Referrals: ${referrals.count}\n` +
        `🎁 Reward: 7 days of PRO for every friend's first payment.`;

      bot.sendMessage(chatId, referralMsg);
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /referral');
    }
  });

  // Handle /upgrade command
  bot.onText(/\/upgrade/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await ensureUserExists(msg);
      
      let upgradeMsg = `💎 Choose your tier to unlock premium signals:\n\n` +
        `🔹 PRO ($3 USD / 5,000 MWK): Personal alerts & Stats.\n` +
        `👑 VIP ($7 USD / 12,000 MWK): Real-time & High frequency.\n\n`;

      if (user.tier !== 'free') {
        const expiry = new Date(user.subscribed_until).toLocaleDateString();
        upgradeMsg = `⭐ Your current ${user.tier.toUpperCase()} subscription expires on ${expiry}.\n\n` +
          `Want to renew or upgrade? Choose a plan below:`;
      }

      const domain = process.env.APP_BASE_URL || 'http://localhost:3000';
      
      bot.sendMessage(chatId, upgradeMsg, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💎 Pro (5,000 MWK)", url: `${domain}/subscribe/pro?telegramId=${chatId}&currency=MWK` },
              { text: "👑 VIP (12,000 MWK)", url: `${domain}/subscribe/vip?telegramId=${chatId}&currency=MWK` }
            ],
            [
              { text: "💎 Pro ($3 USD)", url: `${domain}/subscribe/pro?telegramId=${chatId}&currency=USD` },
              { text: "👑 VIP ($7 USD)", url: `${domain}/subscribe/vip?telegramId=${chatId}&currency=USD` }
            ]
          ]
        }
      });
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /upgrade');
    }
  });

  // Handle /stats command
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await ensureUserExists(msg);
      if (user.tier === 'free') {
        return bot.sendMessage(chatId, "⚠️ Performance analytics are for PRO and VIP users only. Use /upgrade to unlock!");
      }

      const stats = await analyticsService.getSignalStats(user.id);
      const topPairs = await analyticsService.getTopPairs();

      let statsMsg = `📊 Performance Analytics (30d)\n\n` +
        `✅ Total Signals: ${stats.totalSignals}\n` +
        `📈 Avg Spread: ${stats.avgSpread}%\n` +
        `🏆 Best Spread: ${stats.bestSpread}%\n` +
        `💰 Est. ROI (net): ${stats.estimatedROI}%\n\n` +
        `🔥 Top 3 Pairs (7d):\n`;

      topPairs.slice(0, 3).forEach((p, i) => {
        statsMsg += `${i + 1}. ${p.pair}: ${parseFloat(p.avg_spread).toFixed(2)}%\n`;
      });

      bot.sendMessage(chatId, statsMsg);
    } catch (err) {
      logger.error({ err: err.message }, 'Error in /stats');
    }
  });

  bot.on('polling_error', (error) => {
    logger.error({ err: error.message }, 'Telegram Bot polling error');
  });

  logger.info('Telegram Bot initialized with Tiers');
  return bot;
};

/**
 * Sends an arbitrage alert to a user or channel
 * @param {string|number} targetId 
 * @param {object} alert 
 */
const sendAlert = async (targetId, alert) => {
  if (!bot || !targetId) return;

  // Sanitize targetId (remove whitespace and handle URLs)
  let chatId = targetId.toString().trim();
  
  if (chatId.includes('t.me/')) {
    if (chatId.includes('t.me/+')) {
      logger.warn({ targetId }, 'Cannot send alert to a private join link. Please use the numeric Channel ID (e.g., -100...) instead.');
      return;
    }
    // Extract username from public link (e.g., https://t.me/SpreadX_public -> @SpreadX_public)
    const username = chatId.split('t.me/')[1].split('/')[0];
    chatId = `@${username}`;
  } else if (isNaN(chatId) && !chatId.startsWith('@')) {
    // If it's a string but not numeric and doesn't start with @, assume it's a username
    chatId = `@${chatId}`;
  }

  const message = `🚨 Arbitrage Opportunity\n\n` +
                  `Pair: ${alert.pair}\n` +
                  `Buy: ${alert.buyFrom} @ ${alert.buyPrice.toLocaleString()}\n` +
                  `Sell: ${alert.sellTo} @ ${alert.sellPrice.toLocaleString()}\n` +
                  `Spread: +${alert.spread}%\n\n` +
                  `⏰ ${new Date(alert.timestamp).toLocaleTimeString()}`;

  try {
    await bot.sendMessage(chatId, message);
  } catch (error) {
    logger.error({ err: error.message, targetId, resolvedChatId: chatId }, 'Error sending alert');
  }
};

/**
 * Admin function to upgrade user
 * @param {string} telegramId 
 */
const upgradeUser = async (telegramId) => {
  try {
    const result = await db.run('UPDATE users SET tier = ?, subscription_status = ? WHERE telegram_id = ?', ['pro', 'PREMIUM', telegramId.toString()]);
    if (result.changes > 0) {
      logger.info({ telegramId }, 'User upgraded to PRO');
      if (bot) bot.sendMessage(telegramId, '🎉 Congratulations! Your account has been upgraded to PRO. You will now receive real-time alerts!');
      return true;
    }
    return false;
  } catch (error) {
    logger.error({ err: error.message, telegramId }, 'Error upgrading user');
    return false;
  }
};

module.exports = {
  initBot,
  sendAlert,
  upgradeUser,
  getBot: () => bot
};
