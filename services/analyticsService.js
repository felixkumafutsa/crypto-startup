const db = require('../database/db');
const logger = require('../utils/logger');

/**
 * Gets signal statistics for a specific user or global.
 * @param {number|null} userId 
 * @param {number} days 
 * @returns {Promise<Object>}
 */
const getSignalStats = async (userId = null, days = 30) => {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_signals,
        AVG(spread) as avg_spread,
        MAX(spread) as best_spread
      FROM signals s
    `;

    let params = [days];

    if (userId) {
      query += `
        INNER JOIN received_signals rs ON s.id = rs.signal_id
        WHERE rs.user_id = ? AND s.created_at > datetime('now', '-' || ? || ' days')
      `;
      params.unshift(userId); // Add userId to the beginning of the params array
    } else {
      query += `
      WHERE created_at > datetime('now', '-' || ? || ' days')
      `;
    }

    const stats = await db.get(query, params);
    
    const total = parseInt(stats.total_signals || 0);
    const avgSpread = parseFloat(stats.avg_spread || 0);
    const bestSpread = parseFloat(stats.best_spread || 0);
    
    // Simple ROI: (spread - 0.2% fees)
    // 0.1% buy fee + 0.1% sell fee = 0.2%
    const estimatedROI = total > 0 ? (avgSpread - 0.2) : 0;

    return {
      totalSignals: total,
      avgSpread: avgSpread.toFixed(2),
      bestSpread: bestSpread.toFixed(2),
      estimatedROI: estimatedROI.toFixed(2)
    };
  } catch (err) {    
    logger.error({ err: err.message }, 'Error getting signal stats');
    return { totalSignals: 0, avgSpread: 0, bestSpread: 0, estimatedROI: 0 };
  }
};

/**
 * Gets top pairs by average spread.
 * @param {number} days 
 * @returns {Promise<Array>}
 */
const getTopPairs = async (days = 7) => {
  try {
    const query = `
      SELECT 
        pair, 
        AVG(spread) as avg_spread 
      FROM signals 
      WHERE created_at > datetime('now', '-' || ? || ' days')
      GROUP BY pair
      ORDER BY avg_spread DESC
      LIMIT 5
    `;
    return await db.all(query, [days]);
  } catch (err) {
    logger.error({ err: err.message }, 'Error getting top pairs');
    return [];
  }
};

module.exports = {
  getSignalStats,
  getTopPairs
};