const crypto = require("crypto");
const { enrichTradeJournalEntry, tradeJournalGuidelinesPassed } = require("./tradeGuidelines");
const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TRADE_LOG_FILE = path.join(DATA_DIR, "trade-log.json");

const MAINNET = "https://fapi.binance.com";
const TESTNET = "https://testnet.binancefuture.com";

let exchangeInfoCache = { at: 0, symbols: {} };

function futuresSymbol(tvSymbol) {
  return String(tvSymbol || "")
    .replace(/^[^:]+:/i, "")
    .toUpperCase();
}

function sign(query, secret) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

function baseUrl(settings) {
  return settings.binanceTestnet ? TESTNET : MAINNET;
}

async function signedRequest(settings, method, endpoint, params = {}) {
  const apiKey = settings.binanceApiKey?.trim();
  const apiSecret = settings.binanceApiSecret?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("Binance API key and secret are required");
  }

  const payload = {
    ...params,
    timestamp: Date.now(),
    recvWindow: 5000,
  };

  const query = new URLSearchParams(
    Object.entries(payload).map(([k, v]) => [k, String(v)])
  ).toString();
  const signature = sign(query, apiSecret);
  const url = `${baseUrl(settings)}${endpoint}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Binance invalid response (${res.status})`);
  }

  if (!res.ok || data.code) {
    throw new Error(formatBinanceError(data, settings));
  }

  return data;
}

function formatBinanceError(data, settings) {
  const msg = data.msg || `Binance error (${data.code || "unknown"})`;
  const lower = msg.toLowerCase();

  if (
    lower.includes("invalid api-key") ||
    lower.includes("ip") ||
    lower.includes("permissions")
  ) {
    const network = settings.binanceTestnet ? "TESTNET" : "LIVE (mainnet)";
    const host = settings.binanceTestnet
      ? "testnet.binancefuture.com"
      : "fapi.binance.com";
    return (
      `${msg}\n\n` +
      `Calling: ${host} (${network})\n\n` +
      `Most common fix: if your keys are from binance.com, uncheck ` +
      `"Use Binance Futures Testnet", Save, then Test again.\n\n` +
      `Also check on Binance API Management:\n` +
      `• IP restriction: add your public IP, or turn IP restriction OFF\n` +
      `• Enable Futures (USDⓈ-M) on the key\n` +
      `• Key + secret saved correctly (paste both, then Save All Settings)`
    );
  }

  return msg;
}

async function publicGet(settings, endpoint, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = `${baseUrl(settings)}${endpoint}${query ? `?${query}` : ""}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.code) {
    throw new Error(data.msg || `Binance public error (${res.status})`);
  }
  return data;
}

async function getSymbolFilters(settings, symbol) {
  const now = Date.now();
  if (now - exchangeInfoCache.at > 60 * 60 * 1000 || !exchangeInfoCache.symbols[symbol]) {
    const info = await publicGet(settings, "/fapi/v1/exchangeInfo");
    const map = {};
    for (const s of info.symbols || []) {
      map[s.symbol] = s;
    }
    exchangeInfoCache = { at: now, symbols: map };
  }

  const meta = exchangeInfoCache.symbols[symbol];
  if (!meta) throw new Error(`Symbol ${symbol} not found on Binance Futures`);

  const lot = meta.filters.find((f) => f.filterType === "LOT_SIZE");
  const minNotional = meta.filters.find(
    (f) => f.filterType === "MIN_NOTIONAL" || f.filterType === "NOTIONAL"
  );

  const priceFilter = meta.filters.find((f) => f.filterType === "PRICE_FILTER");

  return {
    stepSize: Number(lot?.stepSize || 0.001),
    minQty: Number(lot?.minQty || 0),
    minNotional: Number(minNotional?.notional || minNotional?.minNotional || 5),
    tickSize: Number(priceFilter?.tickSize || 0.01),
  };
}

function roundStep(qty, step) {
  if (!step || step <= 0) return qty;
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  const rounded = Math.floor(qty / step) * step;
  return Number(rounded.toFixed(precision));
}

function roundPrice(price, tickSize) {
  if (!tickSize || tickSize <= 0) return Number(price.toFixed(8));
  const precision = Math.max(0, Math.round(-Math.log10(tickSize)));
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(precision));
}

async function getMarkPrice(settings, symbol) {
  const ticker = await publicGet(settings, "/fapi/v1/ticker/price", { symbol });
  return Number(ticker.price);
}

async function getPositionAmt(settings, symbol) {
  const rows = await signedRequest(settings, "GET", "/fapi/v2/positionRisk", { symbol });
  const row = Array.isArray(rows) ? rows.find((r) => r.symbol === symbol) : rows;
  return Number(row?.positionAmt || 0);
}

async function fetchAccountSnapshot(settings) {
  return signedRequest(settings, "GET", "/fapi/v2/account");
}

async function fetchOpenPositions(settings) {
  const rows = await signedRequest(settings, "GET", "/fapi/v2/positionRisk");
  return Array.isArray(rows) ? rows : [];
}

async function fetchIncomeHistory(settings, { startTime, endTime, limit = 1000 } = {}) {
  const types = ["REALIZED_PNL", "COMMISSION"];
  const all = [];

  for (const incomeType of types) {
    const params = { incomeType, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;
    const rows = await signedRequest(settings, "GET", "/fapi/v1/income", params);
    if (Array.isArray(rows)) all.push(...rows);
  }

  return all.sort((a, b) => Number(b.time) - Number(a.time));
}

async function ensureLeverage(settings, symbol) {
  try {
    await signedRequest(settings, "POST", "/fapi/v1/leverage", {
      symbol,
      leverage: settings.tradeLeverage,
    });
  } catch (err) {
    // Ignore if already set or not changeable.
    if (!/No need to change/i.test(err.message)) {
      console.warn(`Leverage set warning (${symbol}):`, err.message);
    }
  }

  try {
    await signedRequest(settings, "POST", "/fapi/v1/marginType", {
      symbol,
      marginType: settings.tradeMarginType,
    });
  } catch (err) {
    if (!/No need to change/i.test(err.message)) {
      console.warn(`Margin type warning (${symbol}):`, err.message);
    }
  }
}

async function loadTradeLog() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(TRADE_LOG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendTradeLog(entry) {
  const log = await loadTradeLog();
  log.unshift(entry);
  await fs.writeFile(TRADE_LOG_FILE, JSON.stringify(log.slice(0, 500), null, 2));
  return entry;
}

async function logTradeError({ coinId, coinName, symbol, signal, error, analysis }) {
  return appendTradeLog({
    id: `${Date.now()}-${coinId}-err`,
    at: new Date().toISOString(),
    coinId,
    coinName: coinName || coinId,
    symbol: symbol || "",
    signal,
    status: "error",
    error: String(error || "Unknown error"),
    analysis: analysis || null,
  });
}

async function logTradeSkipped({
  coinId,
  coinName,
  symbol,
  signal,
  reason,
  guidelines,
  analysis,
}) {
  return appendTradeLog({
    id: `${Date.now()}-${coinId}-skip`,
    at: new Date().toISOString(),
    coinId,
    coinName: coinName || coinId,
    symbol: symbol || "",
    signal,
    status: "skipped",
    reason: String(reason || "Skipped"),
    guidelines: guidelines || null,
    analysis: analysis || null,
  });
}

async function placeMarketOrder(settings, { symbol, side, quantity, reduceOnly = false }) {
  const params = {
    symbol,
    side,
    type: "MARKET",
    quantity,
  };
  if (reduceOnly) params.reduceOnly = "true";
  return signedRequest(settings, "POST", "/fapi/v1/order", params);
}

async function cancelOpenOrders(settings, symbol) {
  try {
    await signedRequest(settings, "DELETE", "/fapi/v1/allOpenOrders", { symbol });
  } catch (err) {
    if (!/No such order|Unknown order/i.test(err.message)) {
      console.warn(`Cancel open orders (${symbol}):`, err.message);
    }
  }
}

/**
 * Place take-profit and stop-loss as close-position market triggers.
 * direction: "long" | "short"
 */
async function placeTpSlOrders(settings, { symbol, direction, entryPrice }) {
  const tpPct = Number(settings.tradeTpPercent) || 0;
  const slPct = Number(settings.tradeSlPercent) || 0;
  if (tpPct <= 0 && slPct <= 0) return [];

  const filters = await getSymbolFilters(settings, symbol);
  const closeSide = direction === "long" ? "SELL" : "BUY";
  const placed = [];

  await cancelOpenOrders(settings, symbol);

  if (tpPct > 0) {
    const tpRaw =
      direction === "long"
        ? entryPrice * (1 + tpPct / 100)
        : entryPrice * (1 - tpPct / 100);
    const stopPrice = roundPrice(tpRaw, filters.tickSize);
    const order = await signedRequest(settings, "POST", "/fapi/v1/order", {
      symbol,
      side: closeSide,
      type: "TAKE_PROFIT_MARKET",
      stopPrice,
      closePosition: "true",
      workingType: "MARK_PRICE",
    });
    placed.push({ action: "take_profit", stopPrice, percent: tpPct, order });
  }

  if (slPct > 0) {
    const slRaw =
      direction === "long"
        ? entryPrice * (1 - slPct / 100)
        : entryPrice * (1 + slPct / 100);
    const stopPrice = roundPrice(slRaw, filters.tickSize);
    const order = await signedRequest(settings, "POST", "/fapi/v1/order", {
      symbol,
      side: closeSide,
      type: "STOP_MARKET",
      stopPrice,
      closePosition: "true",
      workingType: "MARK_PRICE",
    });
    placed.push({ action: "stop_loss", stopPrice, percent: slPct, order });
  }

  return placed;
}

function entryPriceFromOrder(order, fallbackPrice) {
  const avg = Number(order?.avgPrice);
  if (avg > 0) return avg;
  return fallbackPrice;
}

async function quantityFromUsdt(settings, symbol, usdt) {
  const price = await getMarkPrice(settings, symbol);
  const filters = await getSymbolFilters(settings, symbol);
  let qty = roundStep(usdt / price, filters.stepSize);

  if (qty < filters.minQty) {
    throw new Error(`Quantity ${qty} below min ${filters.minQty} for ${symbol}`);
  }
  if (qty * price < filters.minNotional) {
    throw new Error(
      `Notional $${(qty * price).toFixed(2)} below min $${filters.minNotional} for ${symbol}`
    );
  }

  return { quantity: qty, price };
}

/**
 * Execute a trade for a new chart signal.
 * tradeMode:
 *  - long_only: BUY opens/adds long, SELL closes long
 *  - reversal: BUY goes long (closes short first), SELL goes short (closes long first)
 */
async function executeSignalTrade({ coin, signal, settings, analysis }) {
  if (!settings.autoTradeEnabled) {
    return { skipped: true, reason: "Auto-trade disabled" };
  }
  if (!settings.binanceApiKey || !settings.binanceApiSecret) {
    return { skipped: true, reason: "Binance API keys not configured" };
  }
  if (signal !== "buy" && signal !== "sell") {
    return { skipped: true, reason: "No tradeable signal" };
  }

  const symbol = futuresSymbol(coin.symbol);
  if (!symbol) throw new Error(`Invalid symbol for coin ${coin.id}`);

  await ensureLeverage(settings, symbol);

  const mode = settings.tradeMode || "long_only";
  const usdt = settings.tradeAmountUsdt;
  const positionAmt = await getPositionAmt(settings, symbol);
  const actions = [];

  if (signal === "buy") {
    if (mode === "reversal" && positionAmt < 0) {
      await cancelOpenOrders(settings, symbol);
      const closeQty = Math.abs(positionAmt);
      const order = await placeMarketOrder(settings, {
        symbol,
        side: "BUY",
        quantity: closeQty,
        reduceOnly: true,
      });
      actions.push({ action: "close_short", order });
    }

    if (mode === "long_only" || mode === "reversal") {
      const { quantity, price } = await quantityFromUsdt(settings, symbol, usdt);
      const order = await placeMarketOrder(settings, {
        symbol,
        side: "BUY",
        quantity,
      });
      const entryPrice = entryPriceFromOrder(order, price);
      actions.push({ action: "open_long", quantity, price: entryPrice, order });

      const tpSl = await placeTpSlOrders(settings, {
        symbol,
        direction: "long",
        entryPrice,
      });
      actions.push(...tpSl);
    }
  } else if (signal === "sell") {
    if (mode === "long_only") {
      if (positionAmt <= 0) {
        return { skipped: true, reason: "No long position to close", symbol };
      }
      await cancelOpenOrders(settings, symbol);
      const closeQty = Math.abs(positionAmt);
      const order = await placeMarketOrder(settings, {
        symbol,
        side: "SELL",
        quantity: closeQty,
        reduceOnly: true,
      });
      actions.push({ action: "close_long", quantity: closeQty, order });
    } else {
      if (positionAmt > 0) {
        await cancelOpenOrders(settings, symbol);
        const closeQty = Math.abs(positionAmt);
        const order = await placeMarketOrder(settings, {
          symbol,
          side: "SELL",
          quantity: closeQty,
          reduceOnly: true,
        });
        actions.push({ action: "close_long", order });
      }
      const { quantity, price } = await quantityFromUsdt(settings, symbol, usdt);
      const order = await placeMarketOrder(settings, {
        symbol,
        side: "SELL",
        quantity,
      });
      const entryPrice = entryPriceFromOrder(order, price);
      actions.push({ action: "open_short", quantity, price: entryPrice, order });

      const tpSl = await placeTpSlOrders(settings, {
        symbol,
        direction: "short",
        entryPrice,
      });
      actions.push(...tpSl);
    }
  }

  const entry = {
    id: `${Date.now()}-${coin.id}`,
    at: new Date().toISOString(),
    coinId: coin.id,
    coinName: coin.name,
    symbol,
    signal,
    mode,
    usdt,
    leverage: settings.tradeLeverage,
    tpPercent: settings.tradeTpPercent,
    slPercent: settings.tradeSlPercent,
    testnet: Boolean(settings.binanceTestnet),
    analysis: analysis || null,
    actions: actions.map((a) => ({
      action: a.action,
      quantity: a.quantity,
      price: a.price,
      stopPrice: a.stopPrice,
      percent: a.percent,
      orderId: a.order?.orderId,
      status: a.order?.status,
      avgPrice: a.order?.avgPrice,
    })),
    status: "ok",
  };

  await appendTradeLog(entry);
  return entry;
}

async function testBinanceConnection(settings) {
  const account = await signedRequest(settings, "GET", "/fapi/v2/account");
  return {
    ok: true,
    canTrade: account.canTrade,
    totalWalletBalance: account.totalWalletBalance,
    availableBalance: account.availableBalance,
    testnet: Boolean(settings.binanceTestnet),
  };
}

async function listTrades(limit = 50) {
  const log = await loadTradeLog();
  const passed = [];
  for (const entry of log) {
    if (!tradeJournalGuidelinesPassed(entry)) continue;
    passed.push(enrichTradeJournalEntry(entry));
    if (passed.length >= limit) break;
  }
  return passed;
}

async function getTradeById(id) {
  const log = await loadTradeLog();
  const trade = log.find((t) => t.id === id) || null;
  if (!trade || !tradeJournalGuidelinesPassed(trade)) return null;
  return enrichTradeJournalEntry(trade);
}

module.exports = {
  executeSignalTrade,
  testBinanceConnection,
  listTrades,
  getTradeById,
  logTradeError,
  logTradeSkipped,
  futuresSymbol,
  fetchAccountSnapshot,
  fetchIncomeHistory,
  fetchOpenPositions,
};
