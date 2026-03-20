const axios = require('axios');
const crypto = require('crypto');
const db = require('../database/db');
const logger = require('../utils/logger');

const PAYCHANGU_BASE_URL = 'https://api.paychangu.com';

/**
 * Initiates a PayChangu Standard Checkout session.
 * 
 * @param {Object} user DB user row { id, telegram_id, username }
 * @param {string} tier 'pro' or 'vip'
 * @param {string} currency 'MWK' or 'USD'
 * @returns {Promise<string>} Checkout session URL
 */
const createCheckoutSession = async (user, tier, currency = 'MWK') => {
  try {
    const tx_ref = `ARBBOT-${user.id}-${tier.toUpperCase()}-${Date.now()}`;
    
    // Determine amount from env vars
    const envVarLegacy = `${tier.toUpperCase()}_PRICE_${currency.toUpperCase()}`;
    const envVarNew = `PAYCHANGU_${tier.toUpperCase()}_PRICE`;
    const amount = process.env[envVarNew] || process.env[envVarLegacy];
    
    if (!amount) {
      throw new Error(`Price for ${tier} in ${currency} not configured (${envVarNew} or ${envVarLegacy})`);
    }

    const body = {
      amount: parseFloat(amount),
      currency: currency.toUpperCase(),
      email: null, // user may not have email
      first_name: user.username || "Subscriber",
      last_name: "",
      callback_url: `${process.env.APP_BASE_URL}/webhook/paychangu`,
      return_url: `${process.env.APP_BASE_URL}/payment/return`,
      tx_ref: tx_ref,
      customization: {
        title: `Crypto Arb Bot — ${tier.toUpperCase()} Plan`,
        description: "Monthly subscription to the Crypto Arbitrage Signal Bot"
      },
      meta: {
        user_id: user.id,
        telegram_id: user.telegram_id,
        tier: tier
      }
    };

    const response = await axios.post(`${PAYCHANGU_BASE_URL}/payment`, body, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.status === 'success') {
      // Save payment record
      await db.run(
        'INSERT INTO payments (user_id, amount, currency, status, tx_ref) VALUES (?, ?, ?, ?, ?)',
        [user.id, parseFloat(amount), currency.toUpperCase(), 'pending', tx_ref]
      );

      return response.data.data.checkout_url;
    } else {
      throw new Error(response.data?.message || 'PayChangu initiation failed');
    }
  } catch (err) {
    logger.error({ 
      err: err.message, 
      response: err.response?.data,
      userId: user.id, 
      tier 
    }, 'Error creating PayChangu checkout session');
    throw new Error('Could not initiate payment. Please try again later.');
  }
};

/**
 * Verifies a payment with PayChangu before granting access.
 * 
 * @param {string} tx_ref 
 * @returns {Promise<boolean>}
 */
const verifyTransaction = async (tx_ref) => {
  try {
    const response = await axios.get(`${PAYCHANGU_BASE_URL}/verify-payment/${tx_ref}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`
      }
    });

    const data = response.data.data;
    const payment = await db.get('SELECT * FROM payments WHERE tx_ref = ?', [tx_ref]);

    if (!payment) {
      logger.warn({ tx_ref }, 'Payment record not found for verification');
      return false;
    }

    if (
      response.data.status === 'success' &&
      data.status === 'success' &&
      data.tx_ref === tx_ref &&
      data.currency === payment.currency &&
      parseFloat(data.amount) >= parseFloat(payment.amount)
    ) {
      return true;
    }

    logger.warn({ tx_ref, data, payment }, 'Payment verification failed: criteria not met');
    return false;
  } catch (err) {
    logger.error({ err: err.message, tx_ref }, 'Error verifying PayChangu transaction');
    return false;
  }
};

/**
 * Activates a user's tier after verified payment.
 * 
 * @param {string} tx_ref 
 * @returns {Promise<Object|null>} Updated user row
 */
const activateSubscription = async (tx_ref) => {
  try {
    const isVerified = await verifyTransaction(tx_ref);
    if (!isVerified) return null;

    const payment = await db.get('SELECT * FROM payments WHERE tx_ref = ?', [tx_ref]);
    if (!payment || payment.status === 'confirmed') return null;

    // Determine tier from tx_ref (e.g., ARBBOT-1-PRO-123456)
    const tier = tx_ref.split('-')[2].toLowerCase();

    // Update payment
    await db.run(
      'UPDATE payments SET status = ?, updated_at = NOW() WHERE tx_ref = ?',
      ['confirmed', tx_ref]
    );

    // Update user
    await db.run(
      "UPDATE users SET tier = ?, subscribed_until = NOW() + INTERVAL '30 days' WHERE id = ?",
      [tier, payment.user_id]
    );

    const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [payment.user_id]);
    logger.info({ userId: payment.user_id, tier, tx_ref }, 'Subscription activated');
    
    return updatedUser;
  } catch (err) {
    logger.error({ err: err.message, tx_ref }, 'Error activating subscription');
    throw err;
  }
};

/**
 * Verifies and processes incoming PayChangu webhook events.
 * 
 * @param {Buffer} rawBody 
 * @param {string} signatureHeader 
 */
const handleWebhook = async (rawBody, signatureHeader) => {
  const computedSig = crypto
    .createHmac('sha256', process.env.PAYCHANGU_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (computedSig !== signatureHeader) {
    logger.error('Invalid PayChangu webhook signature');
    throw new Error('Invalid webhook signature');
  }

  const payload = JSON.parse(rawBody.toString());
  const eventType = payload.event_type;
  const data = payload.data || payload; // Some payloads might have data nested or flat

  try {
    if ((eventType === 'checkout.payment' || eventType === 'api.charge.payment') && data.status === 'success') {
      const tx_ref = data.tx_ref || data.reference;
      await activateSubscription(tx_ref);
    } else if (data.status === 'failed' || data.status === 'cancelled') {
      const tx_ref = data.tx_ref || data.reference;
      if (tx_ref) {
        await db.run(
          'UPDATE payments SET status = ?, updated_at = NOW() WHERE tx_ref = ?',
          ['failed', tx_ref]
        );
      }
    }
  } catch (err) {
    logger.error({ err: err.message, eventType }, 'Error handling webhook event');
  }
};

module.exports = {
  createCheckoutSession,
  verifyTransaction,
  activateSubscription,
  handleWebhook
};
