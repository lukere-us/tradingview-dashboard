const fs = require("fs/promises");
const path = require("path");
const { resolveLastActed } = require("./signalMemory");
const { listSets, HISTORY_DIR } = require("./historyStore");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "signal-history.json");

function dayKey(iso = new Date().toISOString()) {
  return iso.slice(0, 10);
}

function emptyDayCell() {
  return { buy: 0, sell: 0, passedBuy: 0, passedSell: 0 };
}

function initCoinRow(coinId, dayList) {
  const days = {};
  for (const day of dayList) {
    days[day] = emptyDayCell();
  }
  return {
    coinId,
    days,
    totals: { buy: 0, sell: 0, passedBuy: 0, passedSell: 0 },
  };
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
 * Record buy/sell only when it is new.
 * Same direction is ignored only while still inside the 2-candle hold window.
 * After 2 candles, the same label can count again.
 */
async function recordSignalEvent(coinId, result, previous, chartInterval = "15") {
  const signal = result?.signal;
  if (signal !== "buy" && signal !== "sell") return null;

  const { lastActed, holdActive } = resolveLastActed(previous, chartInterval);
  if (holdActive && lastActed === signal) {
    return null;
  }

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

async function loadSetSignalsMap(set) {
  if (set.signals && typeof set.signals === "object") {
    return set.signals;
  }

  try {
    const raw = await fs.readFile(path.join(HISTORY_DIR, set.id, "meta.json"), "utf8");
    const meta = JSON.parse(raw);
    return meta.signals || null;
  } catch {
    return null;
  }
}

function countSnapshot(row, day, snap) {
  if (!snap?.isNewSignal) return;

  if (snap.signal === "buy") {
    row.days[day].buy += 1;
    row.totals.buy += 1;
    if (snap.guidelinesOk) {
      row.days[day].passedBuy += 1;
      row.totals.passedBuy += 1;
    }
  } else if (snap.signal === "sell") {
    row.days[day].sell += 1;
    row.totals.sell += 1;
    if (snap.guidelinesOk) {
      row.days[day].passedSell += 1;
      row.totals.passedSell += 1;
    }
  }
}

function eventKey(event) {
  return `${event.coinId}:${event.at}`;
}

async function getSignalStats({ days = 7, coinIds = null } = {}) {
  const events = await loadHistory();
  const dayList = listDays(days);
  const daySet = new Set(dayList);
  const sinceMs = new Date(`${dayList[0]}T00:00:00.000Z`).getTime();

  const sets = (await listSets()).filter(
    (set) => new Date(set.at).getTime() >= sinceMs
  );

  const coinIdSet = new Set(
    coinIds && coinIds.length > 0
      ? coinIds
      : [
          ...new Set([
            ...events.filter((e) => daySet.has(e.day)).map((e) => e.coinId),
            ...sets.flatMap((s) => (s.coins || []).map((c) => c.id)),
          ]),
        ]
  );

  const ids = [...coinIdSet].sort();
  const byCoin = {};
  for (const id of ids) {
    byCoin[id] = initCoinRow(id, dayList);
  }

  const countedEvents = new Set();

  for (const set of sets) {
    const day = dayKey(set.at);
    if (!daySet.has(day)) continue;

    const signals = await loadSetSignalsMap(set);
    if (!signals) continue;

    for (const [coinId, snap] of Object.entries(signals)) {
      const row = byCoin[coinId];
      if (!row) continue;
      countSnapshot(row, day, snap);
    }

    for (const event of events) {
      if (dayKey(event.at) !== day) continue;
      const diff = Math.abs(new Date(event.at).getTime() - new Date(set.at).getTime());
      if (diff > 120_000) continue;
      countedEvents.add(eventKey(event));
    }
  }

  const relevant = events.filter((e) => daySet.has(e.day));
  for (const event of relevant) {
    if (countedEvents.has(eventKey(event))) continue;

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
      passedBuy: ids.reduce((n, id) => n + byCoin[id].totals.passedBuy, 0),
      passedSell: ids.reduce((n, id) => n + byCoin[id].totals.passedSell, 0),
    },
  };
}

module.exports = {
  recordSignalEvent,
  getSignalStats,
  loadHistory,
  dayKey,
};
