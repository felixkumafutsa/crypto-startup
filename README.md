# CryptoSpreadX

A production-ready MVP for a Crypto Arbitrage Alert Telegram Bot with a modern Admin Dashboard.

## Features
- **Price Aggregation**: Real-time prices from Binance, Bybit, and OKX.
- **Arbitrage Engine**: Detects spread opportunities across exchanges.
- **Telegram Integration**: Commands for registration, status, and subscription.
- **Admin Dashboard**: Modern UI to monitor live prices, users, and alerts.
- **Multi-tier Alerts**: Real-time for Premium users, 10-minute delay for Free users.

## Setup
1. `npm install`
2. Create `.env` from `.env.example` and add your `TELEGRAM_BOT_TOKEN`.
3. `npm run dev`

## Admin Dashboard
Access the dashboard at `http://localhost:3000`.
- View live market prices.
- Monitor arbitrage history.
- Manage users and upgrade them to Premium.