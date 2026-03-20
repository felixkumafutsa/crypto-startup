const { Pool } = require('pg');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

dotenv.config();

/**
 * PostgreSQL connection pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

/**
 * Initialize database by running migrations.
 */
const initDb = async () => {
  const migrate = require('./migrate');
  await migrate();
};

/**
 * Run a query that modifies the database (INSERT, UPDATE, DELETE).
 * @param {string} sql 
 * @param {Array} params 
 * @returns {Promise<{id: number|null, changes: number}>}
 */
const run = async (sql, params = []) => {
  try {
    // Convert ? to $1, $2, etc. for PostgreSQL
    let pgSql = sql;
    let count = 1;
    while (pgSql.includes('?')) {
      pgSql = pgSql.replace('?', `$${count++}`);
    }
    const result = await pool.query(pgSql, params);
    // Note: result.insertId is not a thing in pg, usually we use RETURNING id
    const insertedId = result.rows[0]?.id || null;
    return { id: insertedId, changes: result.rowCount };
  } catch (err) {
    logger.error({ err: err.message, sql, params }, 'Database run error');
    throw err;
  }
};

/**
 * Fetch a single row from the database.
 * @param {string} sql 
 * @param {Array} params 
 * @returns {Promise<Object|null>}
 */
const get = async (sql, params = []) => {
  try {
    let pgSql = sql;
    let count = 1;
    while (pgSql.includes('?')) {
      pgSql = pgSql.replace('?', `$${count++}`);
    }
    const result = await pool.query(pgSql, params);
    return result.rows[0] || null;
  } catch (err) {
    logger.error({ err: err.message, sql, params }, 'Database get error');
    throw err;
  }
};

/**
 * Fetch all rows from the database.
 * @param {string} sql 
 * @param {Array} params 
 * @returns {Promise<Array>}
 */
const all = async (sql, params = []) => {
  try {
    let pgSql = sql;
    let count = 1;
    while (pgSql.includes('?')) {
      pgSql = pgSql.replace('?', `$${count++}`);
    }
    const result = await pool.query(pgSql, params);
    return result.rows;
  } catch (err) {
    logger.error({ err: err.message, sql, params }, 'Database all error');
    throw err;
  }
};

module.exports = {
  initDb,
  run,
  get,
  all,
  pool // Export pool if needed for direct access
};
