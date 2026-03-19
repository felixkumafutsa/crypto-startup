const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

dotenv.config();

const dbPath = path.resolve(process.env.DATABASE_PATH || './database.sqlite');
const db = new sqlite3.Database(dbPath);

const initDb = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_id TEXT UNIQUE NOT NULL,
          username TEXT,
          subscription_status TEXT DEFAULT 'FREE',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          logger.error({ err: err.message }, 'Error creating users table');
          reject(err);
        }
      });

      // Create Alerts table
      db.run(`
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pair TEXT NOT NULL,
          spread REAL NOT NULL,
          buy_from TEXT NOT NULL,
          sell_to TEXT NOT NULL,
          buy_price REAL,
          sell_price REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          logger.error({ err: err.message }, 'Error creating alerts table');
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

module.exports = {
  initDb,
  run,
  get,
  all
};
