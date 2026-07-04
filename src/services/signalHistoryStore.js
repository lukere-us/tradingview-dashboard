const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "signal-history.json");

function dayKey(iso = new Date().toISOString()) {
  return iso.slice(0, 10);
}

async function loadHistory() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveHistory(events) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(events, null, 2));
}

/**
 * Record a buy/sell only when the signal *changes* (new appearance).
 * Same label seen on every capture is not counted again.
 */
async function recordSignalEvent(coinId, result, previous) {
  const signal = result?.signal;
  if (signal !== "buy" && signal !== "sell") return null;

  const prevSignal = previous?.signal || "none";
  if (prevSignal === signal) return null;

  const at = result.analyzedAt || new Date().toISOString();
  const event = {
    coinId,
    signal,
    position: result.position || null,
    at,
    day: dayKey(at),
  };

  const events = await loadHistory();
  events.push(event);
  await saveHistory(events);
  return event;
}

function listDays(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Build per-coin daily buy/sell counts for the last N days.
 */
async function getSignalStats({ days = 7, coinIds = null } = {}) {
  const events = await loadHistory();
  const dayList = listDays(days);
  const daySet = new Set(dayList);
  const relevant = events.filter((e) => daySet.has(e.day));

  const ids =
    coinIds && coinIds.length > 0
      ? coinIds
      : [...new Set(relevant.map((e) => e.coinId))].sort();

  const byCoin = {};
  for (const id of ids) {
    byCoin[id] = {
      coinId: id,
      days: {},
      totals: { buy: 0, sell: 0 },
    };
    for (const day of dayList) {
      byCoin[id].days[day] = { buy: 0, sell: 0 };
    }
  }

  for (const event of relevant) {
    const row = byCoin[event.coinId];
    if (!row) continue;
    if (event.signal === "buy") {
      row.days[event.day].buy += 1;
      row.totals.buy += 1;
    } else if (event.signal === "sell") {
      row.days[event.day].sell += 1;
      row.totals.sell += 1;
    }
  }

  return {
    days: dayList,
    coins: ids.map((id) => byCoin[id]),
    totals: {
      buy: ids.reduce((n, id) => n + byCoin[id].totals.buy, 0),
      sell: ids.reduce((n, id) => n + byCoin[id].totals.sell, 0),
    },
  };
}

module.exports = {
  recordSignalEvent,
  getSignalStats,
  loadHistory,
  dayKey,
};
