const axios = require('axios');
const logger = require('../utils/logger');

const FETCH_TIMEOUT = 8000; // Increased timeout

const axiosInstance = axios.create({
  timeout: FETCH_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
  }
});

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
    // Try multiple Binance API endpoints
    const endpoints = [
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      `https://api1.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      `https://api2.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      `https://api3.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      `https://api.binance.us/api/v3/ticker/price?symbol=${symbol}` // Try US endpoint as fallback
    ];
    
    let lastError;
    for (const url of endpoints) {
      try {
        const response = await axiosInstance.get(url);
        const data = normalizeData('Binance', symbol, response.data.price);
        logger.debug({ exchange: 'Binance', pair: symbol, price: data.price }, 'Price fetched');
        return data;
      } catch (e) {
        lastError = e;
        continue;
      }
    }
    throw lastError;
  } catch (error) {
    logger.error({ 
      err: error.message, 
      code: error.code,
      response: error.response?.status,
      exchange: 'Binance' 
    }, 'Error fetching Binance price');
    return null;
  }
};

/**
 * Fetches price from Bybit
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<object|null>}
 */
const fetchBybitPrice = async (symbol) => {
  const endpoints = [
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`,
    `https://api.bytick.com/v5/market/tickers?category=spot&symbol=${symbol}`,
    `https://api-testnet.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
  ];

  for (const url of endpoints) {
    try {
      const response = await axiosInstance.get(url);
      if (!response.data?.result?.list?.[0]) continue;
      
      const price = response.data.result.list[0].lastPrice;
      const data = normalizeData('Bybit', symbol, price);
      logger.debug({ exchange: 'Bybit', pair: symbol, price: data.price }, 'Price fetched');
      return data;
    } catch (error) {
      logger.debug({ err: error.message, url }, 'Bybit endpoint failed');
    }
  }
  
  logger.error({ exchange: 'Bybit', pair: symbol }, 'All Bybit endpoints failed');
  return null;
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
    const response = await axiosInstance.get(`https://www.okx.com/api/v5/market/ticker?instId=${okxSymbol}`);
    if (!response.data?.data?.[0]) throw new Error('Invalid response format');
    
    const price = response.data.data[0].last;
    const data = normalizeData('OKX', symbol, price);
    logger.debug({ exchange: 'OKX', pair: symbol, price: data.price }, 'Price fetched');
    return data;
  } catch (error) {
    logger.error({ 
      err: error.message, 
      code: error.code,
      response: error.response?.status,
      exchange: 'OKX' 
    }, 'Error fetching OKX price');
    return null;
  }
};

/**
 * Fetches price from KuCoin
 * @param {string} symbol (e.g., BTC-USDT)
 * @returns {Promise<object|null>}
 */
const fetchKuCoinPrice = async (symbol) => {
  try {
    const kucoinSymbol = symbol.replace('USDT', '-USDT');
    const response = await axiosInstance.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kucoinSymbol}`);
    if (!response.data?.data?.price) throw new Error('Invalid response format');
    
    const data = normalizeData('KuCoin', symbol, response.data.data.price);
    logger.debug({ exchange: 'KuCoin', pair: symbol, price: data.price }, 'Price fetched');
    return data;
  } catch (error) {
    logger.error({ 
      err: error.message, 
      exchange: 'KuCoin' 
    }, 'Error fetching KuCoin price');
    return null;
  }
};

/**
 * Fetches price from Gate.io
 * @param {string} symbol (e.g., BTC_USDT)
 * @returns {Promise<object|null>}
 */
const fetchGatePrice = async (symbol) => {
  const gateSymbol = symbol.replace('USDT', '_USDT');
  const endpoints = [
    `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${gateSymbol}`,
    `https://data.gateapi.io/api2/1/ticker/${gateSymbol.toLowerCase()}`,
    `https://api.gate.io/api2/1/ticker/${gateSymbol.toLowerCase()}`
  ];

  for (const url of endpoints) {
    try {
      const response = await axiosInstance.get(url);
      
      // Handle different API versions
      let price;
      if (response.data?.[0]?.last) { // v4
        price = response.data[0].last;
      } else if (response.data?.last) { // v2
        price = response.data.last;
      }

      if (price) {
        const data = normalizeData('Gate.io', symbol, price);
        logger.debug({ exchange: 'Gate.io', pair: symbol, price: data.price }, 'Price fetched');
        return data;
      }
    } catch (error) {
      logger.debug({ err: error.message, url }, 'Gate.io endpoint failed');
    }
  }

  logger.error({ exchange: 'Gate.io', pair: symbol }, 'All Gate.io endpoints failed');
  return null;
};

/**
 * Fetches prices from all supported exchanges
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<Array>}
 */
const getAllPrices = async (symbol) => {
  try {
    const fetchers = [
      fetchBinancePrice(symbol),
      fetchBybitPrice(symbol),
      fetchOKXPrice(symbol),
      fetchKuCoinPrice(symbol),
      fetchGatePrice(symbol)
    ];

    const results = await Promise.all(fetchers);
    return results.filter(p => p !== null);
  } catch (error) {
    logger.error({ err: error.message, symbol }, 'Error in getAllPrices');
    return [];
  }
};

/**
 * Fetches prices from all supported exchanges and returns the best arbitrage opportunity.
 * @param {string} symbol (e.g., BTCUSDT)
 * @returns {Promise<Object|null>}
 */
const getBestOpportunity = async (symbol) => {
  const prices = await getAllPrices(symbol);
  if (prices.length < 2) return null;

  let minPrice = prices[0];
  let maxPrice = prices[0];

  for (const p of prices) {
    if (p.price < minPrice.price) minPrice = p;
    if (p.price > maxPrice.price) maxPrice = p;
  }

  const spreadPercent = ((maxPrice.price - minPrice.price) / minPrice.price) * 100;

  return {
    pair: symbol,
    buyExchange: minPrice.exchange,
    buyPrice: minPrice.price,
    sellExchange: maxPrice.exchange,
    sellPrice: maxPrice.price,
    spreadPercent: parseFloat(spreadPercent.toFixed(4)),
    timestamp: Date.now()
  };
};

module.exports = {
  getAllPrices,
  getBestOpportunity,
  fetchBinancePrice,
  fetchBybitPrice,
  fetchOKXPrice,
  fetchKuCoinPrice,
  fetchGatePrice
};
