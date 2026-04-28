const { Pool } = require('pg');
const logger = require('../utils/logger');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  logger.error('DATABASE_URL is not set. Please check your .env file.');
  process.exit(1);
}

// Supabase and other cloud DBs require SSL. We can disable it for local dev if needed.
const dbUrl = new URL(process.env.DATABASE_URL);
const isLocalDb = dbUrl.hostname === 'localhost' || dbUrl.hostname === '127.0.0.1';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

pool.on('connect', () => logger.info('Connected to PostgreSQL database'));
pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'));

const queryInterface = {
  run: async (sql, params = []) => pool.query(sql, params),
  get: async (sql, params = []) => {
    const { rows } = await pool.query(sql, params);
    return rows[0];
  },
  all: async (sql, params = []) => {
    const { rows } = await pool.query(sql, params);
    return rows;
  },
};

const db = {
  pool,
  ...queryInterface,
  initDb,
  isProduction,
};

const initDb = async () => {
  const migrate = require('./migrate');
  await migrate();
};

module.exports = db;