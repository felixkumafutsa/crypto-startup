const { Pool } = require('pg');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

/**
 * Database migration script to create necessary tables for the monetisation upgrade.
 */
const migrate = async () => {
  const client = await pool.connect();
  try {
    logger.info('Starting database migration...');

    // 1. Signals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id SERIAL PRIMARY KEY,
        pair VARCHAR(20),
        spread NUMERIC(10,4),
        buy_exchange VARCHAR(50),
        sell_exchange VARCHAR(50),
        buy_price NUMERIC(20,8),
        sell_price NUMERIC(20,8),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    logger.info('Table "signals" checked/created.');

    // 2. Users table (ensure columns exist for existing table)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username VARCHAR(100),
        tier VARCHAR(20) DEFAULT 'free',
        subscribed_until TIMESTAMPTZ,
        referral_code VARCHAR(20) UNIQUE,
        referred_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure columns for existing users table
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tier') THEN
          ALTER TABLE users ADD COLUMN tier VARCHAR(20) DEFAULT 'free';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscribed_until') THEN
          ALTER TABLE users ADD COLUMN subscribed_until TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referral_code') THEN
          ALTER TABLE users ADD COLUMN referral_code VARCHAR(20) UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='referred_by') THEN
          ALTER TABLE users ADD COLUMN referred_by INT REFERENCES users(id);
        END IF;
      END $$;
    `);
    logger.info('Table "users" checked/created/updated.');

    // 3. User Alerts table (for custom thresholds)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_alerts (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        pair VARCHAR(20) NOT NULL,
        threshold NUMERIC(10,4) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, pair)
      );
    `);
    logger.info('Table "user_alerts" checked/created.');

    // 4. Payments table (enhanced for Paychangu)
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        amount NUMERIC(10,2),
        currency VARCHAR(10),
        status VARCHAR(20) DEFAULT 'pending',  -- pending | confirmed | failed 
        tx_ref VARCHAR(100) UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    // Add columns if they don't exist (in case table already exists)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='tx_ref') THEN
          ALTER TABLE payments ADD COLUMN tx_ref VARCHAR(100) UNIQUE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='updated_at') THEN
          ALTER TABLE payments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
        END IF;
      END $$;
    `);
    logger.info('Table "payments" checked/created/updated.');

    logger.info('Database migration completed successfully.');
  } catch (err) {
    logger.error({ err: err.message }, 'Database migration failed');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = migrate;
