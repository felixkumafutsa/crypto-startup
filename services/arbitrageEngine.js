/**
 * Finds arbitrage opportunities among the provided exchange prices
 * @param {Array} prices Array of objects { exchange, pair, price, timestamp }
 * @param {number} threshold Spread percentage threshold (e.g., 1.5)
 * @returns {Array} Array of alert objects
 */
const findOpportunities = (prices, threshold) => {
  if (prices.length < 2) return [];

  const opportunities = [];

  for (let i = 0; i < prices.length; i++) {
    for (let j = 0; j < prices.length; j++) {
      if (i === j) continue;

      const buyFrom = prices[i];
      const sellTo = prices[j];

      // spread = ((sell_price - buy_price) / buy_price) * 100
      const spread = ((sellTo.price - buyFrom.price) / buyFrom.price) * 100;

      if (spread >= threshold) {
        opportunities.push({
          pair: buyFrom.pair,
          buyFrom: buyFrom.exchange,
          sellTo: sellTo.exchange,
          buyPrice: buyFrom.price,
          sellPrice: sellTo.price,
          spread: parseFloat(spread.toFixed(2)),
          timestamp: Date.now()
        });
      }
    }
  }

  return opportunities;
};

module.exports = {
  findOpportunities
};
