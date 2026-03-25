const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const BetterSqlite3 = require('better-sqlite3');
const logger = require('../utils/logger');

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

let db;
let queryInterface;

if (isProduction) {
  // Production: PostgreSQL
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL is not set for production environment.');
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  pool.on('connect', () => logger.info('Connected to PostgreSQL database'));
  pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'));

  queryInterface = {
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
  
  db = pool; // For direct pool access if needed

} else {
  // Development: SQLite
  const dbPath = path.resolve(__dirname, '../database.sqlite');
  const sqliteDb = new BetterSqlite3(dbPath, { verbose: logger.info });
  logger.info('Connected to SQLite database (development)');

  queryInterface = {
    run: (sql, params = []) => sqliteDb.prepare(sql).run(params),
    get: (sql, params = []) => sqliteDb.prepare(sql).get(params),
    all: (sql, params = []) => sqliteDb.prepare(sql).all(params),
  };
  
  db = sqliteDb; // For direct DB access
}

const initDb = async () => {
  const migrate = require('./migrate');
  await migrate();
};

module.exports = {
  db,
  initDb,
  ...queryInterface,
  isProduction,
};