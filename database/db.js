const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

dotenv.config();

const isProduction = !!process.env.DATABASE_URL;
let db;
let pgPool;

if (isProduction) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
  });
  logger.info('Using PostgreSQL database with SSL (rejectUnauthorized: false)');
} else {
  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../database.sqlite');
  db = new sqlite3.Database(dbPath);
  logger.info(`Using SQLite database at: ${dbPath}`);
}

const initDb = async () => {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      subscription_status TEXT DEFAULT 'FREE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createAlertsTable = `
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      pair TEXT NOT NULL,
      spread REAL NOT NULL,
      buy_from TEXT NOT NULL,
      sell_to TEXT NOT NULL,
      buy_price REAL,
      sell_price REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createUsersTableSqlite = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      subscription_status TEXT DEFAULT 'FREE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createAlertsTableSqlite = `
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
  `;

  if (isProduction) {
    await pgPool.query(createUsersTable);
    await pgPool.query(createAlertsTable);
  } else {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(createUsersTableSqlite, (err) => {
          if (err) {
            logger.error({ err: err.message }, 'Error creating users table');
            reject(err);
          }
        });
        db.run(createAlertsTableSqlite, (err) => {
          if (err) {
            logger.error({ err: err.message }, 'Error creating alerts table');
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }
};

const run = async (sql, params = []) => {
  if (isProduction) {
    // Convert ? to $1, $2, etc. for PostgreSQL
    let pgSql = sql;
    params.forEach((_, i) => {
      pgSql = pgSql.replace('?', `$${i + 1}`);
    });
    const result = await pgPool.query(pgSql, params);
    return { id: result.insertId, changes: result.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }
};

const get = async (sql, params = []) => {
  if (isProduction) {
    let pgSql = sql;
    params.forEach((_, i) => {
      pgSql = pgSql.replace('?', `$${i + 1}`);
    });
    const result = await pgPool.query(pgSql, params);
    return result.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

const all = async (sql, params = []) => {
  if (isProduction) {
    let pgSql = sql;
    params.forEach((_, i) => {
      pgSql = pgSql.replace('?', `$${i + 1}`);
    });
    const result = await pgPool.query(pgSql, params);
    return result.rows;
  } else {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};

module.exports = {
  initDb,
  run,
  get,
  all
};
