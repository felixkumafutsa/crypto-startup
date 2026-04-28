const { run, get } = require('./db');
const logger = require('../utils/logger');

const migrate = async () => {
  logger.info('Starting database migration...');

  try {
    // 1. Signals table
    await run(`
      CREATE TABLE IF NOT EXISTS signals (
        id SERIAL PRIMARY KEY,
        pair TEXT,
        spread REAL,
        buy_exchange TEXT,
        sell_exchange TEXT,
        buy_price REAL,
        sell_price REAL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    logger.info('Table "signals" checked/created.');

    // 2. Users table
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        tier TEXT DEFAULT 'free',
        subscribed_until TIMESTAMP,
        referral_code TEXT UNIQUE,
        referred_by INTEGER REFERENCES users(id),
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        otp_code TEXT,
        otp_expires_at TIMESTAMP,
        is_verified INTEGER DEFAULT 0,
        session_token TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    logger.info('Table "users" checked/created.');

    // Fail-safe alters (catch errors if columns exist)
    const safeAddColumn = async (colDef) => {
      try {
        await run(`ALTER TABLE users ADD COLUMN ${colDef}`);
      } catch (err) {
        // Ignore duplicate column errors (Postgres code 42701)
        if (err.code !== '42701') logger.debug({ msg: err.message }, 'Column add skipped');
      }
    };

    await safeAddColumn('email TEXT UNIQUE');
    await safeAddColumn('phone TEXT UNIQUE');
    await safeAddColumn('otp_code TEXT');
    await safeAddColumn('otp_expires_at TIMESTAMP');
    await safeAddColumn('is_verified INTEGER DEFAULT 0');
    await safeAddColumn('session_token TEXT UNIQUE');

    // 3. User Alerts table
    await run(`
      CREATE TABLE IF NOT EXISTS user_alerts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        pair TEXT NOT NULL,
        threshold REAL NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, pair)
      );
    `);
    logger.info('Table "user_alerts" checked/created.');

    // 4. Payments table
    await run(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount REAL,
        currency TEXT,
        status TEXT DEFAULT 'pending',
        tx_ref TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    logger.info('Table "payments" checked/created.');

    // 5. Settings table
    await run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    logger.info('Table "settings" checked/created.');

    // Insert default settings if empty
    const row = await get('SELECT COUNT(*) as count FROM settings');
    if (row && parseInt(row.count) === 0) {
      await run(`
        INSERT INTO settings (key, value) VALUES 
        ('PRO_PRICE_USD', '3'),
        ('VIP_PRICE_USD', '7'),
        ('PRO_PRICE_MWK', '5000'),
        ('VIP_PRICE_MWK', '12000')
      `);
      logger.info('Inserted default settings.');
    }
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    throw err;
  }
};

module.exports = migrate;