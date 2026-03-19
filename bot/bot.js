const TelegramBot = require('node-telegram-bot-api');
const db = require('../database/db');
const logger = require('../utils/logger');

let bot;

/**
 * Initializes the Telegram Bot
 * @param {string} token 
 * @returns {TelegramBot}
 */
const initBot = (token) => {
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not provided. Bot will not start.');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  // Handle /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || 'unknown';

    try {
      // Check if user exists
      const user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [chatId.toString()]);
      
      if (!user) {
        await db.run('INSERT INTO users (telegram_id, username, subscription_status) VALUES (?, ?, ?)', [chatId.toString(), username, 'FREE']);
        bot.sendMessage(chatId, 'Welcome to CryptoSpreadX! 🚀\n\nYou are now registered as a FREE user. You will receive alerts with a 10-minute delay.');
      } else {
        bot.sendMessage(chatId, `Welcome back, ${username}! Your current status is: ${user.subscription_status}.`);
      }
    } catch (error) {
      logger.error({ err: error.message }, 'Error in /start command');
      bot.sendMessage(chatId, 'An error occurred while registering. Please try again later.');
    }
  });

  // Handle /subscribe command
  bot.onText(/\/subscribe/, (msg) => {
    const chatId = msg.chat.id;
    const message = `💎 Upgrade to PREMIUM for real-time alerts!\n\n` +
                    `Benefits:\n` +
                    `- Zero delay on alerts\n` +
                    `- Private VIP channel access\n\n` +
                    `To subscribe, send 10 USDT to the following address:\n` +
                    `TRC20: Txxxxxxxxxxxxxxxxxxxxxxxxxxxx\n\n` +
                    `After payment, send your transaction hash and Telegram ID (${chatId}) to @AdminAccount for verification.`;
    bot.sendMessage(chatId, message);
  });

  // Handle /status command
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [chatId.toString()]);
      if (user) {
        bot.sendMessage(chatId, `👤 User: ${user.username}\n⭐ Status: ${user.subscription_status}`);
      } else {
        bot.sendMessage(chatId, 'You are not registered. Please use /start first.');
      }
    } catch (error) {
      logger.error({ err: error.message }, 'Error in /status command');
      bot.sendMessage(chatId, 'An error occurred while fetching your status.');
    }
  });

  bot.on('polling_error', (error) => {
    logger.error({ err: error.message }, 'Telegram Bot polling error');
  });

  logger.info('Telegram Bot initialized');
  return bot;
};

/**
 * Sends an arbitrage alert to a user or channel
 * @param {string|number} targetId 
 * @param {object} alert 
 */
const sendAlert = async (targetId, alert) => {
  if (!bot) return;

  const message = `🚨 Arbitrage Opportunity\n\n` +
                  `Pair: ${alert.pair}\n` +
                  `Buy: ${alert.buyFrom} @ ${alert.buyPrice.toLocaleString()}\n` +
                  `Sell: ${alert.sellTo} @ ${alert.sellPrice.toLocaleString()}\n` +
                  `Spread: +${alert.spread}%\n\n` +
                  `⏰ ${new Date(alert.timestamp).toLocaleTimeString()}`;

  try {
    await bot.sendMessage(targetId, message);
  } catch (error) {
    logger.error({ err: error.message, targetId }, 'Error sending alert');
  }
};

/**
 * Admin function to upgrade user
 * @param {string} telegramId 
 */
const upgradeUser = async (telegramId) => {
  try {
    const result = await db.run('UPDATE users SET subscription_status = ? WHERE telegram_id = ?', ['PREMIUM', telegramId.toString()]);
    if (result.changes > 0) {
      logger.info({ telegramId }, 'User upgraded to PREMIUM');
      if (bot) bot.sendMessage(telegramId, '🎉 Congratulations! Your account has been upgraded to PREMIUM. You will now receive real-time alerts!');
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
