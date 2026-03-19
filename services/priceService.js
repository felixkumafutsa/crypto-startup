const axios = require('axios');
const logger = require('../utils/logger');

const FETCH_TIMEOUT = 5000;

/**
 * Normalizes price data from different exchanges
 * @param {string} exchange 
 * @param {string} pair 
 * @param {number} price 
 * @returns {object}
 */
const normalizeData = (exchange, pair, price) => ({
  exchange,
  pair,
  price: parseFloat(price),
  timestamp: Date.now()
});

/**
 * Fetches price from Binance
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<object|null>}
 */
const fetchBinancePrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { timeout: FETCH_TIMEOUT });
    const data = normalizeData('Binance', symbol, response.data.price);
    logger.debug({ exchange: 'Binance', pair: symbol, price: data.price }, 'Price fetched');
    return data;
  } catch (error) {
    logger.error({ err: error.message, exchange: 'Binance' }, 'Error fetching Binance price');
    return null;
  }
};

/**
 * Fetches price from Bybit
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<object|null>}
 */
const fetchBybitPrice = async (symbol) => {
  try {
    const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, { timeout: FETCH_TIMEOUT });
    const price = response.data.result.list[0].lastPrice;
    const data = normalizeData('Bybit', symbol, price);
    logger.debug({ exchange: 'Bybit', pair: symbol, price: data.price }, 'Price fetched');
    return data;
  } catch (error) {
    logger.error({ err: error.message, exchange: 'Bybit' }, 'Error fetching Bybit price');
    return null;
  }
};

/**
 * Fetches price from OKX
 * @param {string} symbol (e.g., BTC-USDT)
 * @returns {Promise<object|null>}
 */
const fetchOKXPrice = async (symbol) => {
  try {
    // OKX uses BTC-USDT format
    const okxSymbol = symbol.replace('USDT', '-USDT');
    const response = await axios.get(`https://www.okx.com/api/v5/market/ticker?instId=${okxSymbol}`, { timeout: FETCH_TIMEOUT });
    const price = response.data.data[0].last;
    const data = normalizeData('OKX', symbol, price);
    logger.debug({ exchange: 'OKX', pair: symbol, price: data.price }, 'Price fetched');
    return data;
  } catch (error) {
    logger.error({ err: error.message, exchange: 'OKX' }, 'Error fetching OKX price');
    return null;
  }
};

/**
 * Fetches prices from all supported exchanges
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<Array>}
 */
const getAllPrices = async (symbol) => {
  const promises = [
    fetchBinancePrice(symbol),
    fetchBybitPrice(symbol),
    fetchOKXPrice(symbol)
  ];
  const results = await Promise.all(promises);
  return results.filter(res => res !== null);
};

module.exports = {
  getAllPrices,
  fetchBinancePrice,
  fetchBybitPrice,
  fetchOKXPrice
};
