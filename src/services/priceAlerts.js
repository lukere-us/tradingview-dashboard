const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PRICES_FILE = path.join(DATA_DIR, "prices.json");

function binancePair(symbol) {
  return symbol.replace(/^[^:]+:/i, "").toUpperCase();
}

async function loadPriceStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(PRICES_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { current: {}, previous: {}, previousAt: null };
  }
}

async function savePriceStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PRICES_FILE, JSON.stringify(store, null, 2));
}

async function fetchBinanceTickers(coins) {
  if (coins.length === 0) return {};

  const symbols = coins.map((c) => binancePair(c.symbol));
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Binance API error (${res.status})`);
  }

  const rows = await res.json();
  const bySymbol = Object.fromEntries(rows.map((r) => [r.symbol, r]));

  const out = {};
  for (const coin of coins) {
    const pair = binancePair(coin.symbol);
    const row = bySymbol[pair];
    if (!row) continue;

    const price = Number(row.lastPrice);
    const high24h = Number(row.highPrice);
    const low24h = Number(row.lowPrice);
    const change24h = Number(row.priceChangePercent);

    out[coin.id] = {
      price,
      high24h,
      low24h,
      change24h,
      at: new Date().toISOString(),
    };
  }

  return out;
}

function buildAlerts(coins, store, thresholdPercent) {
  const alerts = {};

  for (const coin of coins) {
    const current = store.current[coin.id];
    const previous = store.previous[coin.id];

    if (!current) {
      alerts[coin.id] = { status: "unknown" };
      continue;
    }

    let changeSinceCapture = null;
    if (previous?.price && current.price) {
      changeSinceCapture =
        ((current.price - previous.price) / previous.price) * 100;
    }

    const nearHigh =
      current.high24h > 0 &&
      current.price >= current.high24h * 0.998;
    const nearLow =
      current.low24h > 0 &&
      current.price <= current.low24h * 1.002;

    const bigMove =
      changeSinceCapture != null &&
      Math.abs(changeSinceCapture) >= thresholdPercent;

    let badge = null;
    if (nearHigh) badge = "high";
    else if (nearLow) badge = "low";
    else if (bigMove) badge = changeSinceCapture > 0 ? "up" : "down";

    alerts[coin.id] = {
      status: "ok",
      price: current.price,
      change24h: current.change24h,
      changeSinceCapture,
      nearHigh,
      nearLow,
      bigMove,
      badge,
      previousAt: store.previousAt,
    };
  }

  return alerts;
}

async function getAlerts(coins, thresholdPercent = 3) {
  const store = await loadPriceStore();
  return buildAlerts(coins, store, thresholdPercent);
}

async function refreshPrices(coins, { rotatePrevious = false } = {}) {
  const store = await loadPriceStore();
  const fetched = await fetchBinanceTickers(coins);

  if (rotatePrevious && Object.keys(store.current).length > 0) {
    store.previous = { ...store.current };
    store.previousAt = new Date().toISOString();
  }

  store.current = { ...store.current, ...fetched };
  await savePriceStore(store);
  return store;
}

module.exports = {
  getAlerts,
  refreshPrices,
  loadPriceStore,
};
