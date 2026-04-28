const express = require('express');
const router = express.Router();

const db = require('../database/db');
const logger = require('../utils/logger');
const paymentService = require('../services/paymentService');
const bot = require('../bot/bot');

/**
 * GET /subscribe/:tier
 * Initiate a subscription checkout.
 * Query: ?telegramId=...&currency=MWK  OR  ?sessionToken=...&currency=MWK
 */
router.get('/subscribe/:tier', async (req, res) => {
  const { tier } = req.params;
  const { telegramId, sessionToken, currency = 'MWK' } = req.query;

  if (!['pro', 'vip'].includes(tier)) {
    return res.status(400).send('Invalid tier');
  }

  if (!telegramId && !sessionToken) {
    return res.status(400).json({ error: 'telegramId or sessionToken required' });
  }

  try {
    let user;
    if (sessionToken) {
      user = await db.get('SELECT * FROM users WHERE session_token = ?', [sessionToken]);
    } else {
      user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found. Send /start to the bot or register first.' });
    }

    const checkoutUrl = await paymentService.createCheckoutSession(user, tier, currency);
    res.redirect(checkoutUrl);
  } catch (err) {
    logger.error({ err: err.message }, 'Subscription error');
    res.status(500).send('Could not initiate subscription');
  }
});

/**
 * POST /webhook/paychangu
 * Receive payment events from Paychangu.
 */
router.post(
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
 * GET /payment/return
 * Redirect landing page after Paychangu checkout completes.
 */
router.get('/payment/return', async (req, res) => {
  const { tx_ref, status } = req.query;

  if (status === 'failed' || status === 'cancelled') {
    const botUsername = (await bot.getMe()).username;
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
          <h1 style="color: #ef4444;">Payment Not Completed</h1>
          <p>The payment was not successful. Please return to Telegram and try /upgrade again.</p>
          <a href="https://t.me/${botUsername}" style="color: #3b82f6;">Back to Bot</a>
        </body>
      </html>
    `);
  }

  try {
    const updatedUser = await paymentService.activateSubscription(tx_ref);
    if (updatedUser) {
      const tier   = tx_ref.split('-')[2].toUpperCase();
      const expiry = new Date(updatedUser.subscribed_until).toLocaleDateString();
      const botUsername = (await bot.getMe()).username;

      await bot.getBot().sendMessage(
        updatedUser.telegram_id,
        `✅ Payment confirmed! Your ${tier} subscription is now active until ${expiry}.\n` +
        `Use /status to see your account details.`
      );

      return res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #0f172a; color: white;">
            <h1 style="color: #22c55e;">Payment Successful!</h1>
            <p>Your ${tier} subscription is now active. You can return to Telegram.</p>
            <a href="https://t.me/${botUsername}" style="color: #3b82f6;">Back to Bot</a>
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

module.exports = router;
