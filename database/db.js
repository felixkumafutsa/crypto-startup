const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const logger = require('../utils/logger');

const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error({ err: err.message }, 'Could not connect to database');
  } else {
    logger.info('Connected to SQLite database');
  }
});

/**
 * Initialize database by running migrations.
 */
const initDb = async () => {
  const migrate = require('./migrate');
  await migrate();
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
  db,
  initDb,
  run,
  get,
  all,
  isProduction: process.env.NODE_ENV === 'production'
};