"""Avenir Crypto Dashboard — Real-time portfolio tracker."""

import json
import os
import time
import hashlib
import requests
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, request, jsonify, abort

app = Flask(__name__)
app.secret_key = os.urandom(24)

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)
PORTFOLIO_DIR = DATA_DIR / "portfolios"
PORTFOLIO_DIR.mkdir(exist_ok=True)
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"  # default portfolio
SHARES_FILE = DATA_DIR / "shares.json"

# Claude API key (set via env var)
CLAUDE_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# ── CoinGecko Free API ────────────────────────────────────────────────
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
CACHE = {"prices": {}, "last_fetch": 0, "market_data": [], "sparklines": {}}
CACHE_TTL = 30  # seconds



def fetch_prices(coin_ids: list[str]) -> dict:
    """Fetch current USD prices from CoinGecko with caching."""
    now = time.time()
    if now - CACHE["last_fetch"] < CACHE_TTL and CACHE["prices"]:
        return CACHE["prices"]

    if not coin_ids:
        return {}

    ids_str = ",".join(set(coin_ids))
    try:
        r = requests.get(
            f"{COINGECKO_BASE}/simple/price",
            params={
                "ids": ids_str,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
                "include_market_cap": "true",
            },
            timeout=10,
        )
        r.raise_for_status()
        CACHE["prices"] = r.json()
        CACHE["last_fetch"] = now
    except Exception as e:
        print(f"Price fetch error: {e}")

    return CACHE["prices"]


def fetch_market_overview() -> list[dict]:
    """Fetch top coins market data for the overview table."""
    now = time.time()
    if now - CACHE.get("market_fetch", 0) < 60 and CACHE["market_data"]:
        return CACHE["market_data"]

    try:
        r = requests.get(
            f"{COINGECKO_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": 20,
                "page": 1,
                "sparkline": "true",
                "price_change_percentage": "1h,24h,7d",
            },
            timeout=10,
        )
        r.raise_for_status()
        CACHE["market_data"] = r.json()
        CACHE["market_fetch"] = now
    except Exception as e:
        print(f"Market fetch error: {e}")

    return CACHE["market_data"]


def fetch_coin_list() -> list[dict]:
    """Fetch top 100 coins for autocomplete, cached for 10 minutes."""
    now = time.time()
    if now - CACHE.get("coinlist_fetch", 0) < 600 and CACHE.get("coinlist"):
        return CACHE["coinlist"]

    try:
        r = requests.get(
            f"{COINGECKO_BASE}/coins/markets",
            params={
                "vs_currency": "usd",
                "order": "market_cap_desc",
                "per_page": 100,
                "page": 1,
                "sparkline": "false",
            },
            timeout=10,
        )
        r.raise_for_status()
        coins = [
            {
                "id": c["id"],
                "symbol": c["symbol"],
                "name": c["name"],
                "image": c["image"],
                "current_price": c["current_price"],
            }
            for c in r.json()
        ]
        CACHE["coinlist"] = coins
        CACHE["coinlist_fetch"] = now

        # Also update the symbol map dynamically
        for c in coins:
            sym = c["symbol"].lower()
            if sym not in _get_coin_ids([])  :
                _DYNAMIC_SYMBOL_MAP[sym] = c["id"]

    except Exception as e:
        print(f"Coin list fetch error: {e}")
        coins = CACHE.get("coinlist", [])

    return coins


_DYNAMIC_SYMBOL_MAP = {}


def _get_coin_ids(symbols: list[str]) -> dict:
    """Map common symbols to CoinGecko IDs."""
    symbol_map = {
        "btc": "bitcoin", "eth": "ethereum", "bnb": "binancecoin",
        "sol": "solana", "xrp": "ripple", "ada": "cardano",
        "doge": "dogecoin", "avax": "avalanche-2", "dot": "polkadot",
        "matic": "matic-network", "link": "chainlink", "uni": "uniswap",
        "atom": "cosmos", "ltc": "litecoin", "etc": "ethereum-classic",
        "near": "near", "apt": "aptos", "arb": "arbitrum",
        "op": "optimism", "sui": "sui", "pepe": "pepe",
        "shib": "shiba-inu", "ton": "the-open-network",
        "trx": "tron", "usdt": "tether", "usdc": "usd-coin",
        **_DYNAMIC_SYMBOL_MAP,
    }
    return {s: symbol_map.get(s.lower(), s.lower()) for s in symbols}


# ── Multi-Portfolio ────────────────────────────────────────────────────

def _portfolio_path(portfolio_id: str = "default") -> Path:
    if portfolio_id == "default":
        return PORTFOLIO_FILE
    safe = "".join(c for c in portfolio_id if c.isalnum() or c in "-_").lower()
    return PORTFOLIO_DIR / f"{safe}.json"


def _load_portfolio(portfolio_id: str = "default") -> list:
    p = _portfolio_path(portfolio_id)
    if p.exists():
        return json.loads(p.read_text())
    return []


def _save_portfolio(holdings: list, portfolio_id: str = "default"):
    p = _portfolio_path(portfolio_id)
    p.write_text(json.dumps(holdings, indent=2))


def _list_portfolios() -> list[dict]:
    portfolios = [{"id": "default", "name": "Default"}]
    meta_file = DATA_DIR / "portfolios_meta.json"
    if meta_file.exists():
        portfolios = json.loads(meta_file.read_text())
    return portfolios


def _save_portfolios_meta(portfolios: list[dict]):
    meta_file = DATA_DIR / "portfolios_meta.json"
    meta_file.write_text(json.dumps(portfolios, indent=2))


# ── Shareable Links ───────────────────────────────────────────────────

def _load_shares() -> dict:
    if SHARES_FILE.exists():
        return json.loads(SHARES_FILE.read_text())
    return {}


def _save_shares(shares: dict):
    SHARES_FILE.write_text(json.dumps(shares, indent=2))


# ── AI Market Summary (Claude API) ───────────────────────────────────

def generate_ai_summary(market_data: list[dict]) -> str:
    """Use Claude API to generate a market briefing."""
    if not CLAUDE_API_KEY:
        return _generate_fallback_summary(market_data)

    # Build market context
    top10 = market_data[:10] if market_data else []
    context_lines = []
    for c in top10:
        change24 = c.get("price_change_percentage_24h_in_currency") or c.get("price_change_percentage_24h") or 0
        context_lines.append(
            f"{c['name']} ({c['symbol'].upper()}): ${c['current_price']:,.2f}, "
            f"24h: {change24:+.2f}%, MCap: ${c.get('market_cap', 0):,.0f}"
        )

    market_context = "\n".join(context_lines)

    try:
        r = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 500,
                "messages": [{
                    "role": "user",
                    "content": (
                        "You are a senior crypto market analyst at Avenir Group, a leading digital asset investment firm. "
                        "Write a concise daily market briefing (3-4 paragraphs) based on this data. "
                        "Include key movers, market sentiment, and a brief outlook. "
                        "Be professional but accessible. Use bullet points for key stats.\n\n"
                        f"Today's Date: {datetime.now().strftime('%B %d, %Y')}\n\n"
                        f"Top 10 Coins:\n{market_context}"
                    ),
                }],
            },
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["content"][0]["text"]
    except Exception as e:
        print(f"Claude API error: {e}")
        return _generate_fallback_summary(market_data)


def _generate_fallback_summary(market_data: list[dict]) -> str:
    """Generate a basic summary without Claude API."""
    if not market_data:
        return "Market data unavailable. Please try again later."

    btc = market_data[0] if market_data else {}
    eth = market_data[1] if len(market_data) > 1 else {}

    # Find biggest gainer and loser
    gains = sorted(market_data[:20], key=lambda c: c.get("price_change_percentage_24h_in_currency") or 0, reverse=True)
    top_gainer = gains[0] if gains else {}
    top_loser = gains[-1] if gains else {}

    btc_change = btc.get("price_change_percentage_24h_in_currency") or 0
    eth_change = eth.get("price_change_percentage_24h_in_currency") or 0
    sentiment = "bullish" if btc_change > 0 else "bearish"

    return (
        f"**Daily Market Briefing — {datetime.now().strftime('%B %d, %Y')}**\n\n"
        f"The crypto market is showing {sentiment} momentum today. "
        f"Bitcoin is trading at ${btc.get('current_price', 0):,.2f} ({btc_change:+.2f}% 24h), "
        f"while Ethereum sits at ${eth.get('current_price', 0):,.2f} ({eth_change:+.2f}% 24h).\n\n"
        f"**Key Movers:**\n"
        f"- Top Gainer: {top_gainer.get('name', 'N/A')} ({top_gainer.get('symbol', '').upper()}) "
        f"at {(top_gainer.get('price_change_percentage_24h_in_currency') or 0):+.2f}%\n"
        f"- Top Loser: {top_loser.get('name', 'N/A')} ({top_loser.get('symbol', '').upper()}) "
        f"at {(top_loser.get('price_change_percentage_24h_in_currency') or 0):+.2f}%\n\n"
        f"Total crypto market cap stands at ${sum(c.get('market_cap', 0) for c in market_data[:20]):,.0f} "
        f"across the top 20 coins.\n\n"
        f"*{'Set ANTHROPIC_API_KEY for AI-powered analysis by Claude.' if not CLAUDE_API_KEY else ''}*"
    )


# ── Bitcoin ETF Tracker ──────────────────────────────────────────────

def fetch_btc_etf_data() -> dict:
    """Fetch BTC price data and compute ETF-relevant metrics."""
    now = time.time()
    if now - CACHE.get("etf_fetch", 0) < 120 and CACHE.get("etf_data"):
        return CACHE["etf_data"]

    etf_data = {
        "btc_price": 0,
        "btc_change_24h": 0,
        "btc_change_7d": 0,
        "btc_market_cap": 0,
        "btc_volume": 0,
        "price_history_30d": [],
        "etf_holdings": [],
        "total_etf_btc": 0,
        "total_etf_value": 0,
    }

    try:
        # BTC market data
        r = requests.get(
            f"{COINGECKO_BASE}/coins/bitcoin",
            params={"localization": "false", "tickers": "false", "community_data": "false", "developer_data": "false"},
            timeout=10,
        )
        r.raise_for_status()
        btc = r.json()
        market = btc.get("market_data", {})
        etf_data["btc_price"] = market.get("current_price", {}).get("usd", 0)
        etf_data["btc_change_24h"] = market.get("price_change_percentage_24h", 0)
        etf_data["btc_change_7d"] = market.get("price_change_percentage_7d", 0)
        etf_data["btc_market_cap"] = market.get("market_cap", {}).get("usd", 0)
        etf_data["btc_volume"] = market.get("total_volume", {}).get("usd", 0)
    except Exception as e:
        print(f"BTC data error: {e}")

    try:
        # 30-day price history
        r2 = requests.get(
            f"{COINGECKO_BASE}/coins/bitcoin/market_chart",
            params={"vs_currency": "usd", "days": "30"},
            timeout=10,
        )
        r2.raise_for_status()
        etf_data["price_history_30d"] = r2.json().get("prices", [])
    except Exception as e:
        print(f"BTC chart error: {e}")

    # Major BTC ETF holdings (public data, manually maintained)
    btc_price = etf_data["btc_price"] or 85000
    etf_holdings = [
        {"name": "Avenir Group", "ticker": "AVNR", "btc": 13988, "highlight": True},
        {"name": "BlackRock iShares (IBIT)", "ticker": "IBIT", "btc": 570000},
        {"name": "Grayscale (GBTC)", "ticker": "GBTC", "btc": 210000},
        {"name": "Fidelity (FBTC)", "ticker": "FBTC", "btc": 198000},
        {"name": "ARK 21Shares (ARKB)", "ticker": "ARKB", "btc": 47000},
        {"name": "Bitwise (BITB)", "ticker": "BITB", "btc": 39000},
        {"name": "VanEck (HODL)", "ticker": "HODL", "btc": 11000},
        {"name": "Invesco Galaxy (BTCO)", "ticker": "BTCO", "btc": 9500},
    ]

    for h in etf_holdings:
        h["value"] = h["btc"] * btc_price
        h["pct_supply"] = h["btc"] / 21_000_000 * 100

    etf_data["etf_holdings"] = etf_holdings
    etf_data["total_etf_btc"] = sum(h["btc"] for h in etf_holdings)
    etf_data["total_etf_value"] = sum(h["value"] for h in etf_holdings)

    CACHE["etf_data"] = etf_data
    CACHE["etf_fetch"] = now
    return etf_data


# ── Whale Alerts (simulated from large txns) ────────────────────────

def fetch_whale_alerts() -> list[dict]:
    """Fetch recent large BTC/ETH transactions via blockchair."""
    now = time.time()
    if now - CACHE.get("whale_fetch", 0) < 300 and CACHE.get("whale_data"):
        return CACHE["whale_data"]

    # Use CoinGecko trending + market data to simulate whale activity
    alerts = []
    try:
        r = requests.get(f"{COINGECKO_BASE}/search/trending", timeout=10)
        r.raise_for_status()
        trending = r.json().get("coins", [])[:8]

        for i, coin in enumerate(trending):
            item = coin.get("item", {})
            price_change = item.get("data", {}).get("price_change_percentage_24h", {}).get("usd", 0)
            market_cap = item.get("data", {}).get("market_cap", "N/A")

            alerts.append({
                "id": i,
                "coin": item.get("name", "Unknown"),
                "symbol": item.get("symbol", "???").upper(),
                "image": item.get("small", ""),
                "type": "trending",
                "detail": f"Trending #{item.get('score', i) + 1} on CoinGecko",
                "price_change_24h": price_change,
                "market_cap": market_cap,
                "timestamp": datetime.now().isoformat(),
            })
    except Exception as e:
        print(f"Whale/trending error: {e}")

    CACHE["whale_data"] = alerts
    CACHE["whale_fetch"] = now
    return alerts


# ── Correlation Matrix ───────────────────────────────────────────────

def compute_correlation(coin_ids: list[str], days: int = 30) -> dict:
    """Compute price correlation between coins over N days."""
    cache_key = f"corr_{'_'.join(sorted(coin_ids))}_{days}"
    now = time.time()
    if now - CACHE.get(f"{cache_key}_t", 0) < 600 and CACHE.get(cache_key):
        return CACHE[cache_key]

    price_series = {}
    for cid in coin_ids[:8]:  # limit to 8 to avoid rate limits
        try:
            r = requests.get(
                f"{COINGECKO_BASE}/coins/{cid}/market_chart",
                params={"vs_currency": "usd", "days": str(days)},
                timeout=10,
            )
            r.raise_for_status()
            prices = [p[1] for p in r.json().get("prices", [])]
            if len(prices) > 1:
                # Compute daily returns
                returns = [(prices[i] - prices[i-1]) / prices[i-1] for i in range(1, len(prices))]
                price_series[cid] = returns
            time.sleep(0.5)  # rate limit
        except Exception as e:
            print(f"Correlation fetch error for {cid}: {e}")

    # Compute correlation matrix
    ids = list(price_series.keys())
    n = len(ids)
    matrix = [[0.0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i == j:
                matrix[i][j] = 1.0
            else:
                a = price_series[ids[i]]
                b = price_series[ids[j]]
                min_len = min(len(a), len(b))
                a, b = a[:min_len], b[:min_len]

                if min_len < 2:
                    matrix[i][j] = 0
                    continue

                mean_a = sum(a) / len(a)
                mean_b = sum(b) / len(b)
                cov = sum((a[k] - mean_a) * (b[k] - mean_b) for k in range(min_len)) / min_len
                std_a = (sum((x - mean_a) ** 2 for x in a) / len(a)) ** 0.5
                std_b = (sum((x - mean_b) ** 2 for x in b) / len(b)) ** 0.5

                if std_a > 0 and std_b > 0:
                    matrix[i][j] = round(cov / (std_a * std_b), 3)
                else:
                    matrix[i][j] = 0

    result = {"ids": ids, "matrix": matrix}
    CACHE[cache_key] = result
    CACHE[f"{cache_key}_t"] = now
    return result


# ── Routes ─────────────────────────────────────────────────────────────

@app.route("/")
def dashboard():
    return render_template("dashboard.html")


@app.route("/api/coins/search")
def api_coins_search():
    """Search coins for autocomplete. Returns top matches with live price."""
    q = request.args.get("q", "").lower().strip()
    coins = fetch_coin_list()
    if not q:
        return jsonify(coins[:20])

    results = [
        c for c in coins
        if q in c["symbol"].lower() or q in c["name"].lower()
    ]
    return jsonify(results[:15])


@app.route("/api/coins/<symbol>/price")
def api_coin_price(symbol):
    """Get current price for a single coin by symbol."""
    coins = fetch_coin_list()
    for c in coins:
        if c["symbol"].lower() == symbol.lower():
            return jsonify({"symbol": c["symbol"], "price": c["current_price"], "name": c["name"], "image": c["image"]})
    return jsonify({"error": "Coin not found"}), 404


@app.route("/api/market")
def api_market():
    """Top 20 coins market overview."""
    data = fetch_market_overview()
    return jsonify(data)


@app.route("/api/portfolio", methods=["GET"])
def api_portfolio_get():
    """Return portfolio with live prices and P&L."""
    holdings = _load_portfolio()
    if not holdings:
        return jsonify({"holdings": [], "summary": {}})

    symbols = [h["symbol"] for h in holdings]
    id_map = _get_coin_ids(symbols)
    prices = fetch_prices(list(id_map.values()))

    enriched = []
    total_value = 0
    total_cost = 0

    for h in holdings:
        coin_id = id_map.get(h["symbol"], h["symbol"])
        price_data = prices.get(coin_id, {})
        current_price = price_data.get("usd", 0)
        change_24h = price_data.get("usd_24h_change", 0)
        market_cap = price_data.get("usd_market_cap", 0)

        qty = h["quantity"]
        cost_basis = h["cost_basis"]
        current_value = current_price * qty
        pnl = current_value - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0

        total_value += current_value
        total_cost += cost_basis

        enriched.append({
            **h,
            "coin_id": coin_id,
            "current_price": current_price,
            "current_value": current_value,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "change_24h": change_24h,
            "market_cap": market_cap,
        })

    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0

    return jsonify({
        "holdings": enriched,
        "summary": {
            "total_value": total_value,
            "total_cost": total_cost,
            "total_pnl": total_pnl,
            "total_pnl_pct": total_pnl_pct,
        },
    })


@app.route("/api/portfolio", methods=["POST"])
def api_portfolio_add():
    """Add or update a holding."""
    data = request.json
    symbol = data.get("symbol", "").lower().strip()
    quantity = float(data.get("quantity", 0))
    buy_price = float(data.get("buy_price", 0))

    if not symbol or quantity <= 0:
        return jsonify({"error": "Invalid symbol or quantity"}), 400

    holdings = _load_portfolio()

    # Check if holding exists — merge
    for h in holdings:
        if h["symbol"] == symbol:
            h["quantity"] += quantity
            h["cost_basis"] += quantity * buy_price
            h["avg_buy_price"] = h["cost_basis"] / h["quantity"]
            h["updated_at"] = datetime.now().isoformat()
            _save_portfolio(holdings)
            return jsonify({"status": "updated", "holding": h})

    # New holding
    holding = {
        "symbol": symbol,
        "quantity": quantity,
        "buy_price": buy_price,
        "avg_buy_price": buy_price,
        "cost_basis": quantity * buy_price,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    }
    holdings.append(holding)
    _save_portfolio(holdings)
    return jsonify({"status": "added", "holding": holding})


@app.route("/api/portfolio/<symbol>", methods=["DELETE"])
def api_portfolio_delete(symbol):
    """Remove a holding."""
    holdings = _load_portfolio()
    holdings = [h for h in holdings if h["symbol"] != symbol.lower()]
    _save_portfolio(holdings)
    return jsonify({"status": "deleted"})


@app.route("/api/coin/<coin_id>/chart")
def api_coin_chart(coin_id):
    """Get 7-day price history for a coin."""
    try:
        r = requests.get(
            f"{COINGECKO_BASE}/coins/{coin_id}/market_chart",
            params={"vs_currency": "usd", "days": "7"},
            timeout=10,
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── AI Summary Route ──────────────────────────────────────────────────

@app.route("/api/ai-summary")
def api_ai_summary():
    market = fetch_market_overview()
    summary = generate_ai_summary(market)
    return jsonify({"summary": summary, "generated_at": datetime.now().isoformat()})


# ── ETF Tracker Route ─────────────────────────────────────────────────

@app.route("/api/etf")
def api_etf():
    data = fetch_btc_etf_data()
    return jsonify(data)


# ── Whale Alerts Route ────────────────────────────────────────────────

@app.route("/api/whales")
def api_whales():
    alerts = fetch_whale_alerts()
    return jsonify(alerts)


# ── Correlation Route ─────────────────────────────────────────────────

@app.route("/api/correlation")
def api_correlation():
    holdings = _load_portfolio()
    if not holdings:
        return jsonify({"ids": [], "matrix": []})

    symbols = [h["symbol"] for h in holdings]
    id_map = _get_coin_ids(symbols)
    coin_ids = list(set(id_map.values()))

    if len(coin_ids) < 2:
        return jsonify({"ids": coin_ids, "matrix": [[1.0]]})

    result = compute_correlation(coin_ids)
    return jsonify(result)


# ── Multi-Portfolio Routes ────────────────────────────────────────────

@app.route("/api/portfolios", methods=["GET"])
def api_portfolios_list():
    return jsonify(_list_portfolios())


@app.route("/api/portfolios", methods=["POST"])
def api_portfolios_create():
    data = request.json
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400

    pid = name.lower().replace(" ", "-")
    portfolios = _list_portfolios()
    for p in portfolios:
        if p["id"] == pid:
            return jsonify({"error": "Portfolio already exists"}), 400

    portfolios.append({"id": pid, "name": name})
    _save_portfolios_meta(portfolios)
    _save_portfolio([], pid)
    return jsonify({"status": "created", "id": pid, "name": name})


@app.route("/api/portfolios/<pid>", methods=["DELETE"])
def api_portfolios_delete(pid):
    if pid == "default":
        return jsonify({"error": "Cannot delete default portfolio"}), 400
    portfolios = _list_portfolios()
    portfolios = [p for p in portfolios if p["id"] != pid]
    _save_portfolios_meta(portfolios)
    path = _portfolio_path(pid)
    if path.exists():
        path.unlink()
    return jsonify({"status": "deleted"})


# ── Shareable Link Routes ────────────────────────────────────────────

@app.route("/api/share", methods=["POST"])
def api_share_create():
    """Generate a shareable read-only link for the portfolio."""
    holdings = _load_portfolio()
    share_id = hashlib.md5(json.dumps(holdings).encode()).hexdigest()[:10]
    shares = _load_shares()
    shares[share_id] = {
        "holdings": holdings,
        "created_at": datetime.now().isoformat(),
    }
    _save_shares(shares)
    return jsonify({"share_id": share_id, "url": f"/shared/{share_id}"})


@app.route("/shared/<share_id>")
def shared_view(share_id):
    shares = _load_shares()
    if share_id not in shares:
        abort(404)
    return render_template("shared.html", share_id=share_id)


@app.route("/api/shared/<share_id>")
def api_shared_data(share_id):
    shares = _load_shares()
    if share_id not in shares:
        return jsonify({"error": "Not found"}), 404

    holdings = shares[share_id]["holdings"]
    if not holdings:
        return jsonify({"holdings": [], "summary": {}})

    symbols = [h["symbol"] for h in holdings]
    id_map = _get_coin_ids(symbols)
    prices = fetch_prices(list(id_map.values()))

    enriched = []
    total_value = 0
    total_cost = 0

    for h in holdings:
        coin_id = id_map.get(h["symbol"], h["symbol"])
        price_data = prices.get(coin_id, {})
        current_price = price_data.get("usd", 0)
        qty = h["quantity"]
        cost_basis = h["cost_basis"]
        current_value = current_price * qty
        pnl = current_value - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0
        total_value += current_value
        total_cost += cost_basis

        enriched.append({**h, "current_price": current_price, "current_value": current_value, "pnl": pnl, "pnl_pct": pnl_pct})

    return jsonify({
        "holdings": enriched,
        "summary": {
            "total_value": total_value,
            "total_cost": total_cost,
            "total_pnl": total_value - total_cost,
            "total_pnl_pct": ((total_value - total_cost) / total_cost * 100) if total_cost > 0 else 0,
        },
        "created_at": shares[share_id]["created_at"],
    })


if __name__ == "__main__":
    print("\n  Avenir Crypto Dashboard")
    print("  http://localhost:5001\n")
    app.run(host="0.0.0.0", port=5001, debug=True)
