const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('../database/db');
const logger = require('../utils/logger');
const { sendOTP } = require('../services/notificationService');

/**
 * POST /api/auth/request-otp
 * Send an OTP to the provided email or phone identifier.
 */
router.post('/request-otp', async (req, res) => {
  const { identifier, type } = req.body; // type: 'email' | 'phone'
  if (!identifier || !type) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();

    const column = type === 'email' ? 'email' : 'phone';
    let user = await db.get(`SELECT * FROM users WHERE ${column} = ?`, [identifier]);

    if (!user) {
      // Create a provisional user record (fake telegram_id to satisfy NOT NULL)
      const fakeTelegramId = -Math.floor(Date.now() + Math.random() * 100000);
      await db.run(
        `INSERT INTO users (telegram_id, ${column}, otp_code, otp_expires_at) VALUES (?, ?, ?, ?)`,
        [fakeTelegramId, identifier, code, expiresAt]
      );
    } else {
      await db.run(
        `UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?`,
        [code, expiresAt, user.id]
      );
    }

    await sendOTP(identifier, type, code);
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    logger.error({ err: err.message }, 'Request OTP error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verify an OTP and return a session token.
 */
router.post('/verify-otp', async (req, res) => {
  const { identifier, type, code } = req.body;

  try {
    const column = type === 'email' ? 'email' : 'phone';
    const user = await db.get(`SELECT * FROM users WHERE ${column} = ?`, [identifier]);

    if (!user || user.otp_code !== code) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP has expired' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');

    await db.run(
      `UPDATE users SET otp_code = NULL, otp_expires_at = NULL, is_verified = 1, session_token = ? WHERE id = ?`,
      [sessionToken, user.id]
    );

    res.json({ success: true, token: sessionToken, user: { id: user.id, tier: user.tier } });
  } catch (err) {
    logger.error({ err: err.message }, 'Verify OTP error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
