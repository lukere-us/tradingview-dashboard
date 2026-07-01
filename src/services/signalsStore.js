const fs = require("fs/promises");
const path = require("path");
const { analyzeCoinSignal } = require("./chartSignal");

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

  for (let i = 0; i < coinIds.length; i++) {
    const coinId = coinIds[i];
    onProgress?.({
      phase: "start",
      coinId,
      current: i + 1,
      total: coinIds.length,
    });

    const result = await analyzeCoinSignal(coinId);
    current[coinId] = result;

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
