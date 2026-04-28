const express = require('express');
const router = express.Router();

const db = require('../database/db');
const logger = require('../utils/logger');
const bot = require('../bot/bot');

/**
 * GET /favicon.ico
 * Suppress browser 404 noise.
 */
router.get('/favicon.ico', (req, res) => res.status(204).end());

/**
 * GET /ref/:code
 * Referral deep-link redirect → opens the Telegram bot with the referral code pre-set.
 */
router.get('/ref/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const referrer = await db.get('SELECT * FROM users WHERE referral_code = ?', [code]);
    if (referrer) {
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

module.exports = router;
