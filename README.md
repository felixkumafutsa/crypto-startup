# CryptoSpreadX - Monetisation Upgrade

A production-ready SaaS platform for crypto arbitrage signals.

## 🚀 Features

- **Multi-Exchange Price Aggregation**: Real-time prices from Binance, Bybit, OKX, KuCoin, and Gate.io.
- **Arbitrage Engine**: Detects spread opportunities across 5+ exchanges.
- **Multi-Tier Subscription System**:
  - **FREE**: Public signals only (>1.5% spread), 10-minute delay.
  - **PRO**: Private signals, custom alert thresholds, and performance analytics.
  - **VIP**: Real-time high-frequency signals (60s polling), API access, and priority support.
- **Telegram Bot Integration**:
  - `/start` - Registration and tier overview.
  - `/status` - Current tier and subscription expiry.
  - `/setalert <PAIR> <THRESHOLD>` - Custom thresholds for PRO/VIP.
  - `/referral` - Generate referral links and track rewards.
  - `/upgrade` - Stripe payment links for PRO/VIP.
  - `/stats` - ROI and performance analytics for PRO/VIP.
- **Paychangu Payment Integration**: Automated tier activation and renewal via Paychangu (Malawi's leading payment gateway).
- **Admin Panel**: Private route for monitoring users, revenue, and system health.
- **Member Dashboard**: Personal dashboard with live signals, ROI tracking, and top-performing pairs.

## 🛠 Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Create a `.env` file from `.env.example`:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   DATABASE_URL=postgresql://user:password@host:port/database
   PAYCHANGU_SECRET_KEY=SEC-TEST-...
   PAYCHANGU_WEBHOOK_SECRET=your_webhook_secret
   APP_BASE_URL=https://yourdomain.com
   PRO_PRICE_MWK=5000
   VIP_PRICE_MWK=12000
   PRO_PRICE_USD=3
   VIP_PRICE_USD=7
   ADMIN_TOKEN=your_secure_admin_token
   ```

3. **Database Migration**:
   The application runs migrations automatically on startup via `database/migrate.js`.

4. **Paychangu Webhook Configuration**:
   - Get API keys from [https://in.paychangu.com/user/api](https://in.paychangu.com/user/api).
   - Point your Paychangu webhook to `https://yourdomain.com/webhook/paychangu`.
   - Enabled events: `checkout.payment`, `api.charge.payment`.
   - Note: The webhook endpoint must be publicly accessible (Render URL).

5. **Run the App**:
   ```bash
   npm run dev
   ```

## 📊 Dashboards

- **Member Dashboard (Home)**: `https://crypto-startup-o26i.onrender.com` (Login with Telegram ID)
- **Admin Panel (Private)**: `https://crypto-startup-o26i.onrender.com/admin?token=YOUR_ADMIN_TOKEN`
- **System Dashboard**: `https://crypto-startup-o26i.onrender.com/admin-dashboard.html`

## 🤝 Referral System

- Users get a unique referral code on registration.
- Referrers earn **7 days of PRO access** for every friend's first confirmed payment.
- Shareable links: `https://yourdomain.com/ref/YOUR_CODE`

## 📊 Official Channels

- **Public Channel (Free Signals)**: [https://t.me/SpreadX_public](https://t.me/SpreadX_public)
- **Private Channel (Premium Signals)**: [https://t.me/+teC2S07HkjU0OWE0](https://t.me/+teC2S07HkjU0OWE0)
