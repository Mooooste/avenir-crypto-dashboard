/* ── Avenir Crypto Dashboard — Frontend Logic ─────────────────── */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmt = {
    usd: (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n),
    usdCompact: (n) => {
        if (Math.abs(n) >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
        if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
        if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
        return fmt.usd(n);
    },
    pct: (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%",
    price: (n) => {
        if (n >= 1) return fmt.usd(n);
        return "$" + n.toFixed(6);
    },
};

const COLORS = [
    "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

let allocationChart = null;
let performanceChart = null;
let refreshTimer = null;

// ── Autocomplete System ─────────────────────────────────────────

let searchTimeout = null;

function setupAutocomplete(inputId, dropdownId, priceInputId, priceHintId) {
    const input = $(`#${inputId}`);
    const dropdown = $(`#${dropdownId}`);
    const priceInput = priceInputId ? $(`#${priceInputId}`) : null;
    const priceHint = priceHintId ? $(`#${priceHintId}`) : null;
    let highlightIndex = -1;

    input.addEventListener("input", () => {
        clearTimeout(searchTimeout);
        const q = input.value.trim();

        if (q.length === 0) {
            dropdown.classList.remove("open");
            return;
        }

        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`/api/coins/search?q=${encodeURIComponent(q)}`);
                const coins = await res.json();
                renderDropdown(coins);
            } catch (e) {
                console.error("Search error:", e);
            }
        }, 200);
    });

    input.addEventListener("focus", () => {
        if (input.value.trim().length > 0) {
            input.dispatchEvent(new Event("input"));
        }
    });

    input.addEventListener("keydown", (e) => {
        const items = dropdown.querySelectorAll(".autocomplete-item");
        if (!items.length) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            highlightIndex = Math.min(highlightIndex + 1, items.length - 1);
            updateHighlight(items);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            highlightIndex = Math.max(highlightIndex - 1, 0);
            updateHighlight(items);
        } else if (e.key === "Enter" && highlightIndex >= 0) {
            e.preventDefault();
            items[highlightIndex].click();
        } else if (e.key === "Escape") {
            dropdown.classList.remove("open");
        }
    });

    function updateHighlight(items) {
        items.forEach((item, i) => {
            item.classList.toggle("highlighted", i === highlightIndex);
        });
    }

    function renderDropdown(coins) {
        highlightIndex = -1;
        if (coins.length === 0) {
            dropdown.innerHTML = '<div class="autocomplete-item"><span class="ac-name">No coins found</span></div>';
            dropdown.classList.add("open");
            return;
        }

        dropdown.innerHTML = coins.map((c) => `
            <div class="autocomplete-item" data-symbol="${c.symbol}" data-price="${c.current_price}" data-name="${c.name}">
                <img src="${c.image}" alt="${c.symbol}">
                <div>
                    <span class="ac-name">${c.name}</span>
                    <span class="ac-symbol">${c.symbol.toUpperCase()}</span>
                </div>
                <span class="ac-price">${fmt.price(c.current_price)}</span>
            </div>
        `).join("");

        dropdown.querySelectorAll(".autocomplete-item").forEach((item) => {
            item.addEventListener("click", () => {
                const symbol = item.dataset.symbol;
                const price = parseFloat(item.dataset.price);
                const name = item.dataset.name;

                input.value = symbol.toUpperCase();
                input.dataset.selectedSymbol = symbol;
                dropdown.classList.remove("open");

                // Auto-fill price
                if (priceInput) {
                    priceInput.value = price;
                }
                if (priceHint) {
                    priceHint.textContent = `Market: ${fmt.price(price)} (${name})`;
                }
            });
        });

        dropdown.classList.add("open");
    }

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
        if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${dropdownId}`)) {
            dropdown.classList.remove("open");
        }
    });
}

// Setup autocomplete for all three inputs
setupAutocomplete("inp-symbol", "inp-symbol-dropdown", "inp-buy-price", "inp-price-hint");
setupAutocomplete("modal-symbol", "modal-symbol-dropdown", "modal-buy-price", "modal-price-hint");
setupAutocomplete("quick-symbol", "quick-symbol-dropdown", "quick-price", null);

// Quick-buy: also update the visible price display when coin is selected
const quickSymbolInput = $("#quick-symbol");
const origListener = quickSymbolInput.dataset._hasQuickHook;
$("#quick-symbol-dropdown").addEventListener("click", (e) => {
    const item = e.target.closest(".autocomplete-item");
    if (!item) return;
    const price = parseFloat(item.dataset.price);
    const name = item.dataset.name;
    $("#quick-price").value = price;
    $("#quick-price-display").value = `${fmt.price(price)} (${name})`;
});


// ── Mode Toggle (Custom / Quick Buy) ────────────────────────────

$("#mode-custom").addEventListener("click", () => {
    $("#mode-custom").classList.add("active");
    $("#mode-quick").classList.remove("active");
    $("#form-custom").style.display = "block";
    $("#form-quick").style.display = "none";
});

$("#mode-quick").addEventListener("click", () => {
    $("#mode-quick").classList.add("active");
    $("#mode-custom").classList.remove("active");
    $("#form-quick").style.display = "block";
    $("#form-custom").style.display = "none";
});


// ── Tab Navigation ──────────────────────────────────────────────

$$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
        $$(".nav-item").forEach((i) => i.classList.remove("active"));
        $$(".tab-content").forEach((t) => t.classList.remove("active"));
        item.classList.add("active");
        const tab = item.dataset.tab;
        $(`#tab-${tab}`).classList.add("active");
        $("#page-title").textContent = item.querySelector("span").textContent;

        // Show add button only on dashboard
        $("#btn-add-holding").style.display = tab === "dashboard" ? "block" : "none";
    });
});

// ── Modal ────────────────────────────────────────────────────────

$("#btn-add-holding").addEventListener("click", () => {
    $("#modal-overlay").classList.add("active");
});

$("#modal-cancel").addEventListener("click", () => {
    $("#modal-overlay").classList.remove("active");
});

$("#modal-overlay").addEventListener("click", (e) => {
    if (e.target === $("#modal-overlay")) {
        $("#modal-overlay").classList.remove("active");
    }
});

// ── Add Holding (all three forms) ────────────────────────────────

async function addHolding(symbol, quantity, buyPrice) {
    const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, quantity, buy_price: buyPrice }),
    });
    return res.json();
}

// Custom buy form
$("#add-holding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const symbol = ($("#inp-symbol").dataset.selectedSymbol || $("#inp-symbol").value).trim();
    const qty = parseFloat($("#inp-quantity").value);
    const price = parseFloat($("#inp-buy-price").value);
    if (!symbol || !qty || !price) return;
    await addHolding(symbol, qty, price);
    $("#add-holding-form").reset();
    $("#inp-price-hint").textContent = "";
    refreshAll();
});

// Modal form
$("#modal-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const symbol = ($("#modal-symbol").dataset.selectedSymbol || $("#modal-symbol").value).trim();
    const qty = parseFloat($("#modal-quantity").value);
    const price = parseFloat($("#modal-buy-price").value);
    if (!symbol || !qty || !price) return;
    await addHolding(symbol, qty, price);
    $("#modal-add-form").reset();
    $("#modal-price-hint").textContent = "";
    $("#modal-overlay").classList.remove("active");
    refreshAll();
});

// Quick buy form
$("#quick-buy-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const symbol = ($("#quick-symbol").dataset.selectedSymbol || $("#quick-symbol").value).trim();
    const qty = parseFloat($("#quick-quantity").value);
    const price = parseFloat($("#quick-price").value);
    if (!symbol || !qty || !price) return;
    await addHolding(symbol, qty, price);
    $("#quick-buy-form").reset();
    $("#quick-price-display").value = "";
    refreshAll();
});

// ── Delete Holding ───────────────────────────────────────────────

async function deleteHolding(symbol) {
    await fetch(`/api/portfolio/${symbol}`, { method: "DELETE" });
    refreshAll();
}

// ── Render Portfolio ─────────────────────────────────────────────

async function renderPortfolio() {
    const res = await fetch("/api/portfolio");
    const data = await res.json();
    const { holdings, summary } = data;

    // Summary cards
    $("#total-value").textContent = fmt.usd(summary.total_value || 0);
    $("#total-cost").textContent = fmt.usd(summary.total_cost || 0);
    $("#total-pnl").textContent = fmt.usd(summary.total_pnl || 0);
    $("#total-pnl").className = "card-value " + ((summary.total_pnl || 0) >= 0 ? "change-positive" : "change-negative");
    $("#total-pnl-pct").textContent = fmt.pct(summary.total_pnl_pct || 0);
    $("#total-pnl-pct").className = "card-sub " + ((summary.total_pnl_pct || 0) >= 0 ? "positive" : "negative");
    $("#holdings-count").textContent = holdings.length;

    // Dashboard holdings table
    const tbody = $("#holdings-table-body");
    if (holdings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Add holdings to get started</td></tr>';
    } else {
        tbody.innerHTML = holdings
            .sort((a, b) => b.current_value - a.current_value)
            .map((h) => `
                <tr>
                    <td>
                        <div class="coin-cell">
                            <div>
                                <div class="coin-name">${h.symbol.toUpperCase()}</div>
                            </div>
                        </div>
                    </td>
                    <td>${fmt.price(h.current_price)}</td>
                    <td class="${h.change_24h >= 0 ? 'change-positive' : 'change-negative'}">${fmt.pct(h.change_24h || 0)}</td>
                    <td>${h.quantity.toFixed(4)}</td>
                    <td>${fmt.usd(h.current_value)}</td>
                    <td class="${h.pnl >= 0 ? 'change-positive' : 'change-negative'}">
                        ${fmt.usd(h.pnl)} (${fmt.pct(h.pnl_pct)})
                    </td>
                </tr>
            `).join("");
    }

    // Portfolio management table
    const ptbody = $("#portfolio-table-body");
    if (holdings.length === 0) {
        ptbody.innerHTML = '<tr><td colspan="8" class="empty-state">No holdings yet</td></tr>';
    } else {
        ptbody.innerHTML = holdings.map((h) => `
            <tr>
                <td><strong>${h.symbol.toUpperCase()}</strong></td>
                <td>${h.quantity.toFixed(4)}</td>
                <td>${fmt.price(h.avg_buy_price)}</td>
                <td>${fmt.usd(h.cost_basis)}</td>
                <td>${fmt.price(h.current_price)}</td>
                <td>${fmt.usd(h.current_value)}</td>
                <td class="${h.pnl >= 0 ? 'change-positive' : 'change-negative'}">
                    ${fmt.usd(h.pnl)}<br><small>${fmt.pct(h.pnl_pct)}</small>
                </td>
                <td>
                    <button class="btn-danger" onclick="deleteHolding('${h.symbol}')">Remove</button>
                </td>
            </tr>
        `).join("");
    }

    // Allocation doughnut chart
    renderAllocationChart(holdings);
    // Performance bar chart
    renderPerformanceChart(holdings);
}

function renderAllocationChart(holdings) {
    const ctx = $("#allocation-chart").getContext("2d");

    if (allocationChart) allocationChart.destroy();

    if (holdings.length === 0) {
        allocationChart = new Chart(ctx, {
            type: "doughnut",
            data: { labels: ["Empty"], datasets: [{ data: [1], backgroundColor: ["#2a3555"] }] },
            options: { plugins: { legend: { display: false } }, cutout: "70%" },
        });
        return;
    }

    const sorted = [...holdings].sort((a, b) => b.current_value - a.current_value);

    allocationChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: sorted.map((h) => h.symbol.toUpperCase()),
            datasets: [{
                data: sorted.map((h) => h.current_value),
                backgroundColor: COLORS.slice(0, sorted.length),
                borderWidth: 0,
                hoverOffset: 8,
            }],
        },
        options: {
            cutout: "70%",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#8892a8", padding: 12, font: { size: 12 } },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ` ${ctx.label}: ${fmt.usd(ctx.parsed)} (${pct}%)`;
                        },
                    },
                },
            },
        },
    });
}

function renderPerformanceChart(holdings) {
    const ctx = $("#performance-chart").getContext("2d");

    if (performanceChart) performanceChart.destroy();

    const top = [...holdings]
        .filter((h) => h.change_24h !== undefined)
        .sort((a, b) => b.current_value - a.current_value)
        .slice(0, 8);

    if (top.length === 0) {
        performanceChart = new Chart(ctx, {
            type: "bar",
            data: { labels: ["No data"], datasets: [{ data: [0], backgroundColor: "#2a3555" }] },
            options: { plugins: { legend: { display: false } } },
        });
        return;
    }

    performanceChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: top.map((h) => h.symbol.toUpperCase()),
            datasets: [{
                label: "24h Change %",
                data: top.map((h) => h.change_24h || 0),
                backgroundColor: top.map((h) => (h.change_24h || 0) >= 0 ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)"),
                borderRadius: 6,
                barThickness: 36,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (ctx) => fmt.pct(ctx.parsed.y) },
                },
            },
            scales: {
                x: {
                    ticks: { color: "#8892a8" },
                    grid: { display: false },
                },
                y: {
                    ticks: {
                        color: "#8892a8",
                        callback: (v) => v.toFixed(1) + "%",
                    },
                    grid: { color: "rgba(42,53,85,0.5)" },
                },
            },
        },
    });
}

// ── Render Market Overview ───────────────────────────────────────

async function renderMarket() {
    const res = await fetch("/api/market");
    const coins = await res.json();
    const tbody = $("#market-table-body");

    if (!coins.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Could not load market data</td></tr>';
        return;
    }

    tbody.innerHTML = coins.map((c, i) => {
        const change1h = c.price_change_percentage_1h_in_currency || 0;
        const change24h = c.price_change_percentage_24h_in_currency || 0;
        const change7d = c.price_change_percentage_7d_in_currency || 0;
        const sparkId = `spark-${c.id}`;

        return `
            <tr>
                <td>${i + 1}</td>
                <td>
                    <div class="coin-cell">
                        <img class="coin-icon" src="${c.image}" alt="${c.symbol}">
                        <div>
                            <div class="coin-name">${c.name}</div>
                            <div class="coin-symbol">${c.symbol}</div>
                        </div>
                    </div>
                </td>
                <td>${fmt.price(c.current_price)}</td>
                <td class="${change1h >= 0 ? 'change-positive' : 'change-negative'}">${fmt.pct(change1h)}</td>
                <td class="${change24h >= 0 ? 'change-positive' : 'change-negative'}">${fmt.pct(change24h)}</td>
                <td class="${change7d >= 0 ? 'change-positive' : 'change-negative'}">${fmt.pct(change7d)}</td>
                <td>${fmt.usdCompact(c.market_cap)}</td>
                <td><canvas class="sparkline-canvas" id="${sparkId}"></canvas></td>
            </tr>
        `;
    }).join("");

    // Draw sparklines
    coins.forEach((c) => {
        const sparkData = c.sparkline_in_7d?.price;
        if (!sparkData) return;
        const canvas = document.getElementById(`spark-${c.id}`);
        if (!canvas) return;
        drawSparkline(canvas, sparkData);
    });
}

function drawSparkline(canvas, data) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = 120;
    const h = canvas.height = 40;
    const padding = 2;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const isUp = data[data.length - 1] >= data[0];
    const color = isUp ? "#10b981" : "#ef4444";

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    const step = (w - padding * 2) / (data.length - 1);
    data.forEach((val, i) => {
        const x = padding + i * step;
        const y = h - padding - ((val - min) / range) * (h - padding * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Gradient fill
    const last = data[data.length - 1];
    const lastY = h - padding - ((last - min) / range) * (h - padding * 2);
    ctx.lineTo(padding + (data.length - 1) * step, h);
    ctx.lineTo(padding, h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, isUp ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fill();
}

// ── ETF Tracker ──────────────────────────────────────────────────

let etfPriceChart = null;
let etfHoldingsChart = null;

async function renderETF() {
    try {
        const res = await fetch("/api/etf");
        const data = await res.json();

        $("#etf-btc-price").textContent = fmt.usd(data.btc_price);
        const ch24 = data.btc_change_24h || 0;
        $("#etf-btc-change").textContent = `24h: ${fmt.pct(ch24)} | 7d: ${fmt.pct(data.btc_change_7d || 0)}`;
        $("#etf-btc-change").className = `card-sub ${ch24 >= 0 ? "positive" : "negative"}`;
        $("#etf-total-btc").textContent = data.total_etf_btc.toLocaleString() + " BTC";
        $("#etf-pct-supply").textContent = ((data.total_etf_btc / 21000000) * 100).toFixed(2) + "% of 21M supply";
        $("#etf-total-value").textContent = fmt.usdCompact(data.total_etf_value);
        $("#etf-volume").textContent = fmt.usdCompact(data.btc_volume);

        // Price chart
        const prices = data.price_history_30d || [];
        if (prices.length && $("#etf-price-chart")) {
            const ctx = $("#etf-price-chart").getContext("2d");
            if (etfPriceChart) etfPriceChart.destroy();
            etfPriceChart = new Chart(ctx, {
                type: "line",
                data: {
                    labels: prices.map(p => new Date(p[0]).toLocaleDateString()),
                    datasets: [{
                        label: "BTC Price",
                        data: prices.map(p => p[1]),
                        borderColor: "#f59e0b",
                        backgroundColor: "rgba(245,158,11,0.1)",
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        borderWidth: 2,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt.usd(ctx.parsed.y) } } },
                    scales: {
                        x: { ticks: { color: "#8892a8", maxTicksLimit: 8 }, grid: { display: false } },
                        y: { ticks: { color: "#8892a8", callback: v => fmt.usdCompact(v) }, grid: { color: "rgba(42,53,85,0.5)" } },
                    },
                },
            });
        }

        // ETF holdings table
        const tbody = $("#etf-table-body");
        tbody.innerHTML = data.etf_holdings.map(h => `
            <tr class="${h.highlight ? 'etf-highlight' : ''}">
                <td>${h.name}${h.highlight ? ' <span style="color:var(--accent);">(Our Firm)</span>' : ''}</td>
                <td>${h.ticker}</td>
                <td>${h.btc.toLocaleString()} BTC</td>
                <td>${fmt.usdCompact(h.value)}</td>
                <td>${h.pct_supply.toFixed(3)}%</td>
            </tr>
        `).join("");

        // Holdings doughnut
        if ($("#etf-holdings-chart")) {
            const ctx2 = $("#etf-holdings-chart").getContext("2d");
            if (etfHoldingsChart) etfHoldingsChart.destroy();
            etfHoldingsChart = new Chart(ctx2, {
                type: "doughnut",
                data: {
                    labels: data.etf_holdings.map(h => h.name),
                    datasets: [{
                        data: data.etf_holdings.map(h => h.btc),
                        backgroundColor: ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"],
                        borderWidth: 0,
                    }],
                },
                options: {
                    cutout: "65%", responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "right", labels: { color: "#8892a8", padding: 10, font: { size: 11 } } },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} BTC` } },
                    },
                },
            });
        }
    } catch (e) {
        console.error("ETF render error:", e);
    }
}

// ── AI Briefing ──────────────────────────────────────────────────

async function renderAISummary() {
    const content = $("#ai-summary-content");
    content.innerHTML = '<div class="ai-loading">Generating market analysis...</div>';

    try {
        const res = await fetch("/api/ai-summary");
        const data = await res.json();
        // Render markdown
        if (typeof marked !== "undefined") {
            content.innerHTML = marked.parse(data.summary);
        } else {
            content.innerHTML = data.summary.replace(/\n/g, "<br>");
        }
        $("#ai-generated-at").textContent = `Generated: ${new Date(data.generated_at).toLocaleTimeString()}`;
    } catch (e) {
        content.innerHTML = '<div class="ai-loading">Failed to generate summary. Try again.</div>';
        console.error("AI summary error:", e);
    }
}

$("#btn-refresh-ai").addEventListener("click", renderAISummary);

// ── Whale / Trending ─────────────────────────────────────────────

async function renderWhales() {
    try {
        const res = await fetch("/api/whales");
        const alerts = await res.json();
        const container = $("#whale-alerts-container");

        if (!alerts.length) {
            container.innerHTML = '<div class="empty-state">No trending data available</div>';
            return;
        }

        container.innerHTML = `<div class="whale-grid">${alerts.map(a => `
            <div class="whale-card">
                <img src="${a.image}" alt="${a.symbol}">
                <div class="whale-info">
                    <div class="whale-name">${a.coin} <span style="color:var(--text-muted);font-size:12px;">${a.symbol}</span></div>
                    <div class="whale-detail">${a.detail}</div>
                </div>
                <div class="whale-change ${(a.price_change_24h || 0) >= 0 ? 'change-positive' : 'change-negative'}">
                    ${fmt.pct(a.price_change_24h || 0)}
                </div>
            </div>
        `).join("")}</div>`;
    } catch (e) {
        console.error("Whale render error:", e);
    }
}

// ── Correlation Heatmap ──────────────────────────────────────────

async function renderCorrelation() {
    const container = $("#correlation-container");
    container.innerHTML = '<div class="ai-loading">Computing correlations... (this may take a moment)</div>';

    try {
        const res = await fetch("/api/correlation");
        const data = await res.json();

        if (!data.ids || data.ids.length < 2) {
            container.innerHTML = '<div class="empty-state">Add at least 2 holdings to see correlations</div>';
            return;
        }

        const ids = data.ids;
        const matrix = data.matrix;

        let html = '<table class="corr-table"><thead><tr><th></th>';
        ids.forEach(id => { html += `<th>${id.toUpperCase()}</th>`; });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < ids.length; i++) {
            html += `<tr><th style="text-align:left;padding:10px 14px;color:var(--text-secondary);font-weight:600;text-transform:uppercase;font-size:12px;">${ids[i].toUpperCase()}</th>`;
            for (let j = 0; j < ids.length; j++) {
                const val = matrix[i][j];
                const color = corrColor(val);
                html += `<td style="background:${color};color:#fff;">${val.toFixed(2)}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="empty-state">Error computing correlations</div>';
        console.error("Correlation error:", e);
    }
}

function corrColor(val) {
    // Red for negative, blue for positive, neutral for 0
    if (val >= 0.7) return "rgba(59,130,246,0.8)";
    if (val >= 0.4) return "rgba(59,130,246,0.5)";
    if (val >= 0.1) return "rgba(59,130,246,0.25)";
    if (val >= -0.1) return "rgba(90,101,128,0.3)";
    if (val >= -0.4) return "rgba(239,68,68,0.25)";
    if (val >= -0.7) return "rgba(239,68,68,0.5)";
    return "rgba(239,68,68,0.8)";
}

$("#btn-refresh-corr").addEventListener("click", renderCorrelation);

// ── Share Modal ──────────────────────────────────────────────────

$("#btn-share").addEventListener("click", () => {
    $("#share-modal").classList.add("active");
    $("#share-result").style.display = "none";
    $("#share-generate").style.display = "block";
});

$("#share-close").addEventListener("click", () => {
    $("#share-modal").classList.remove("active");
});

$("#share-modal").addEventListener("click", (e) => {
    if (e.target === $("#share-modal")) $("#share-modal").classList.remove("active");
});

$("#btn-generate-share").addEventListener("click", async () => {
    const res = await fetch("/api/share", { method: "POST" });
    const data = await res.json();
    const fullUrl = window.location.origin + data.url;
    $("#share-url").value = fullUrl;
    $("#share-result").style.display = "block";
    $("#share-generate").style.display = "none";
});

$("#btn-copy-share").addEventListener("click", () => {
    const input = $("#share-url");
    input.select();
    navigator.clipboard.writeText(input.value);
    $("#btn-copy-share").textContent = "Copied!";
    setTimeout(() => { $("#btn-copy-share").textContent = "Copy Link"; }, 2000);
});

// ── Refresh Loop ─────────────────────────────────────────────────

let loadedTabs = new Set(["dashboard"]);

async function refreshAll() {
    try {
        await Promise.all([renderPortfolio(), renderMarket()]);
        $("#last-updated").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
        console.error("Refresh error:", e);
    }
}

// Lazy-load tabs on first visit
function onTabSwitch(tab) {
    if (loadedTabs.has(tab)) return;
    loadedTabs.add(tab);

    if (tab === "etf") renderETF();
    if (tab === "ai") renderAISummary();
    if (tab === "whales") renderWhales();
    if (tab === "correlation") renderCorrelation();
}

// Patch tab navigation to trigger lazy load
$$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
        const tab = item.dataset.tab;
        onTabSwitch(tab);
    });
});

// Initial load
refreshAll();

// Auto-refresh every 30 seconds
refreshTimer = setInterval(refreshAll, 30000);
