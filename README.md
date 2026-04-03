# Avenir Crypto Dashboard

A real-time cryptocurrency portfolio tracker and market analysis platform built for [Avenir Group](https://avenirx.com), Asia's leading digital asset investment firm.

## Features

- **Portfolio Dashboard** — Track holdings with live prices, P&L, allocation charts, and 24h performance
- **Bitcoin ETF Tracker** — Monitor major BTC ETF holdings including Avenir Group's position, 30-day price charts, and supply metrics
- **AI Market Briefing** — Daily market summaries powered by Claude AI with key movers and sentiment analysis
- **Market Overview** — Top 20 coins with 1h/24h/7d changes, market cap, and 7-day sparkline charts
- **Correlation Heatmap** — Visualize how portfolio holdings move together for risk analysis
- **Trending Coins** — Track trending coins and whale activity in real time
- **Shareable Links** — Generate read-only portfolio links for team members
- **Smart Coin Search** — Autocomplete with live prices and quick-buy at market price

## Tech Stack

- **Backend:** Python, Flask
- **Frontend:** HTML/CSS/JavaScript, Chart.js
- **Data:** CoinGecko API (free tier)
- **AI:** Claude API (optional, for market briefings)

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the dashboard
python app.py

# With AI briefings enabled
ANTHROPIC_API_KEY=your-key-here python app.py
```

Open **http://localhost:5001** in your browser.

## Project Structure

```
avenir-crypto-dashboard/
├── app.py                  # Flask backend + API routes
├── requirements.txt        # Python dependencies
├── templates/
│   ├── dashboard.html      # Main dashboard UI
│   └── shared.html         # Read-only shared portfolio view
├── static/
│   ├── css/style.css       # Dark finance theme
│   └── js/app.js           # Frontend logic + charts
└── data/                   # Local portfolio storage (gitignored)
```

## Screenshots

### Dashboard
Portfolio overview with allocation chart and P&L tracking.

### BTC ETF Tracker
Institutional Bitcoin ETF holdings with Avenir Group highlighted.

### AI Market Briefing
Claude-powered daily market analysis and sentiment report.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/portfolio` | GET | Get portfolio with live prices |
| `/api/portfolio` | POST | Add/update a holding |
| `/api/portfolio/<symbol>` | DELETE | Remove a holding |
| `/api/market` | GET | Top 20 market overview |
| `/api/etf` | GET | Bitcoin ETF tracker data |
| `/api/ai-summary` | GET | AI-generated market briefing |
| `/api/correlation` | GET | Portfolio correlation matrix |
| `/api/whales` | GET | Trending coins & whale alerts |
| `/api/coins/search?q=` | GET | Coin autocomplete search |
| `/api/share` | POST | Generate shareable link |

## License

MIT
