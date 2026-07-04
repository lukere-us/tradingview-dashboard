const fs = require("fs/promises");
const path = require("path");
const { analyzeCoinSignal } = require("./chartSignal");
const { recordSignalEvent } = require("./signalHistoryStore");
const { getSettings } = require("./settingsStore");
const { getCoins } = require("./coinsStore");
const { executeSignalTrade, logTradeError, futuresSymbol } = require("./binanceTrade");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SIGNALS_FILE = path.join(DATA_DIR, "signals.json");

async function loadSignals() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(SIGNALS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSignals(signals) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SIGNALS_FILE, JSON.stringify(signals, null, 2));
}

async function getSignals() {
  return loadSignals();
}

async function updateSignalsForCoins(coinIds, onProgress) {
  const current = await loadSignals();
  const settings = await getSettings();
  const coins = await getCoins();
  const coinMap = Object.fromEntries(coins.map((c) => [c.id, c]));

  for (let i = 0; i < coinIds.length; i++) {
    const coinId = coinIds[i];
    onProgress?.({
      phase: "start",
      coinId,
      current: i + 1,
      total: coinIds.length,
    });

    const previous = current[coinId] || null;
    const result = await analyzeCoinSignal(coinId);
    current[coinId] = result;

    const event = await recordSignalEvent(coinId, result, previous).catch(() => null);

    if (event && (event.signal === "buy" || event.signal === "sell")) {
      const coin = coinMap[coinId];
      try {
        if (coin) {
          const trade = await executeSignalTrade({
            coin,
            signal: event.signal,
            settings,
          });
          if (trade?.skipped) {
            console.log(`Auto-trade skipped (${coinId}): ${trade.reason}`);
          } else if (trade?.status === "ok") {
            console.log(`Auto-trade placed (${coinId} ${event.signal})`);
          }
        }
      } catch (err) {
        console.error(`Auto-trade failed (${coinId}):`, err.message);
        await logTradeError({
          coinId,
          coinName: coin?.name,
          symbol: coin ? futuresSymbol(coin.symbol) : "",
          signal: event.signal,
          error: err.message,
        }).catch(() => {});
      }
    }

    onProgress?.({
      phase: "done",
      coinId,
      result,
      current: i + 1,
      total: coinIds.length,
    });
  }

  await saveSignals(current);
  return current;
}

module.exports = {
  getSignals,
  updateSignalsForCoins,
};
