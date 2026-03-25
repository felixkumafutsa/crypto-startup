const { db } = require('./db');
const logger = require('../utils/logger');

const migrate = async () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      logger.info('Starting database migration...');

      // 1. Signals table
      db.run(`
        CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pair TEXT,
          spread REAL,
          buy_exchange TEXT,
          sell_exchange TEXT,
          buy_price REAL,
          sell_price REAL,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `, (err) => {
        if (err) return reject(err);
        logger.info('Table "signals" checked/created.');
      });

      // 2. Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id INTEGER UNIQUE,
          username TEXT,
          tier TEXT DEFAULT 'free',
          subscribed_until TEXT,
          referral_code TEXT UNIQUE,
          referred_by INTEGER REFERENCES users(id),
          email TEXT UNIQUE,
          phone TEXT UNIQUE,
          otp_code TEXT,
          otp_expires_at TEXT,
          is_verified INTEGER DEFAULT 0,
          session_token TEXT UNIQUE,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `, (err) => {
        if (err) return reject(err);
        logger.info('Table "users" checked/created.');
        
        // Fail-safe alters for existing databases (ignores errors if columns already exist)
        db.run("ALTER TABLE users ADD COLUMN email TEXT UNIQUE", () => {});
        db.run("ALTER TABLE users ADD COLUMN phone TEXT UNIQUE", () => {});
        db.run("ALTER TABLE users ADD COLUMN otp_code TEXT", () => {});
        db.run("ALTER TABLE users ADD COLUMN otp_expires_at TEXT", () => {});
        db.run("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0", () => {});
        db.run("ALTER TABLE users ADD COLUMN session_token TEXT UNIQUE", () => {});
      });

      // 3. User Alerts table
      db.run(`
        CREATE TABLE IF NOT EXISTS user_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          pair TEXT NOT NULL,
          threshold REAL NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, pair)
        );
      `, (err) => {
        if (err) return reject(err);
        logger.info('Table "user_alerts" checked/created.');
      });

      // 4. Payments table
      db.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id),
          amount REAL,
          currency TEXT,
          status TEXT DEFAULT 'pending',
          tx_ref TEXT UNIQUE,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `, (err) => {
        if (err) return reject(err);
        logger.info('Table "payments" checked/created.');
      });

      // 5. Settings table
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `, (err) => {
        if (err) return reject(err);
        logger.info('Table "settings" checked/created.');
        
        // Insert default settings if empty
        db.get('SELECT COUNT(*) as count FROM settings', (err, row) => {
          if (!err && row && row.count === 0) {
             const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
             stmt.run('PRO_PRICE_USD', '3');
             stmt.run('VIP_PRICE_USD', '7');
             stmt.run('PRO_PRICE_MWK', '5000');
             stmt.run('VIP_PRICE_MWK', '12000');
             stmt.finalize();
             logger.info('Inserted default settings.');
          }
          resolve();
        });
      });
    });
  });
};

module.exports = migrate;