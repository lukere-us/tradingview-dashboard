const fs = require("fs/promises");
const path = require("path");
const { holdDurationMs } = require("./signalMemory");
const { listSets, HISTORY_DIR } = require("./historyStore");
const { checkTradeGuidelines, buildTradeAnalysis } = require("./tradeGuidelines");
const { getSettings } = require("./settingsStore");
const { getCoins } = require("./coinsStore");

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
 * Dedup uses explicit lastActed fields only — not the live chart signal on the card.
 */
async function recordSignalEvent(coinId, result, previous, chartInterval = "15") {
  const signal = result?.signal;
  if (signal !== "buy" && signal !== "sell") return null;

  const lastActed = previous?.lastActedSignal || null;
  const lastActedAt = previous?.lastActedAt || null;
  if (lastActed && lastActedAt && lastActed === signal) {
    const actedAt = new Date(lastActedAt).getTime();
    if (
      Number.isFinite(actedAt) &&
      Date.now() - actedAt < holdDurationMs(chartInterval)
    ) {
      return null;
    }
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

function countSnapshot(row, day, snap, guidelinesOk) {
  if (!snap?.isNewSignal) return;

  if (snap.signal === "buy") {
    row.days[day].buy += 1;
    row.totals.buy += 1;
    if (guidelinesOk) {
      row.days[day].passedBuy += 1;
      row.totals.passedBuy += 1;
    }
  } else if (snap.signal === "sell") {
    row.days[day].sell += 1;
    row.totals.sell += 1;
    if (guidelinesOk) {
      row.days[day].passedSell += 1;
      row.totals.passedSell += 1;
    }
  }
}

async function resolveSnapGuide(coinId, snap, set, settings) {
  const imagePath = path.join(HISTORY_DIR, set.id, `${coinId}.png`);
  try {
    await fs.access(imagePath);
    return await checkTradeGuidelines({
      coinId,
      signal: snap.signal,
      settings,
      imagePath,
    });
  } catch {
    const percent = snap.guidelinePassPercent ?? null;
    return {
      ok: percent != null ? percent >= 70 : Boolean(snap.guidelinesOk),
      passStats: { percent },
      failures: snap.guidelineFailures || [],
      checklist: [],
      tableResult: null,
    };
  }
}

async function snapshotGuidelinesOk(coinId, snap, set, settings) {
  if (!snap?.isNewSignal) return false;
  if (snap.signal !== "buy" && snap.signal !== "sell") return false;
  const guide = await resolveSnapGuide(coinId, snap, set, settings);
  return Boolean(guide.ok);
}

function matchesSignalKind(snap, guidelinesOk, kind) {
  if (!snap?.isNewSignal) return false;
  if (kind === "buy") return snap.signal === "buy";
  if (kind === "passedBuy") return snap.signal === "buy" && guidelinesOk;
  if (kind === "sell") return snap.signal === "sell";
  if (kind === "passedSell") return snap.signal === "sell" && guidelinesOk;
  return false;
}

async function buildSignalDetailEntry(coin, snap, set, settings, guide) {
  const guidelinesOk = Boolean(guide?.ok);
  const chartResult = {
    signal: snap.signal,
    position: snap.position || null,
    analyzedAt: snap.analyzedAt || set.at,
  };
  const analysis = buildTradeAnalysis({
    coinId: coin.id,
    signal: snap.signal,
    chartResult,
    guide,
    settings,
  });
  analysis.screenshotUrl = `/screenshots/history/${set.id}/${coin.id}.png`;

  return {
    id: `${set.id}-${coin.id}-${snap.signal}-${set.at}`,
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    signal: snap.signal,
    at: set.at,
    position: snap.position || null,
    guidelinesOk,
    guidelinePassPercent: guide?.passStats?.percent ?? null,
    screenshotUrl: analysis.screenshotUrl,
    analysis,
  };
}

async function buildLegacySignalDetail(coin, event, sets, settings, kind) {
  const nearby = sets.find(
    (s) =>
      Math.abs(new Date(s.at).getTime() - new Date(event.at).getTime()) <= 120_000
  );

  if (nearby) {
    const signalsMap = await loadSetSignalsMap(nearby);
    const snap = signalsMap?.[coin.id] || {
      signal: event.signal,
      position: event.position,
      isNewSignal: true,
      analyzedAt: event.at,
    };
    const guide = await resolveSnapGuide(coin.id, snap, nearby, settings);
    const guidelinesOk = Boolean(guide.ok);
    if (!matchesSignalKind(snap, guidelinesOk, kind)) return null;
    return buildSignalDetailEntry(coin, snap, nearby, settings, guide);
  }

  if (kind === "passedBuy" || kind === "passedSell") return null;

  return {
    id: `${event.coinId}:${event.at}`,
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    signal: event.signal,
    at: event.at,
    position: event.position || null,
    guidelinesOk: null,
    guidelinePassPercent: null,
    screenshotUrl: `/screenshots/current/${coin.id}.png`,
    analysis: null,
  };
}

async function getSignalBarDetails({ coinId, kind, days = 7 } = {}) {
  const validKinds = new Set(["buy", "passedBuy", "sell", "passedSell"]);
  if (!validKinds.has(kind)) {
    throw new Error("Invalid signal kind");
  }

  const settings = await getSettings();
  const coins = await getCoins();
  const coin = coins.find((c) => c.id === coinId);
  if (!coin) {
    return { coinId, coinName: coinId, kind, days, signals: [] };
  }

  const periodDays = Math.min(30, Math.max(1, Number(days) || 7));
  const dayList = listDays(periodDays);
  const daySet = new Set(dayList);
  const sinceMs = new Date(`${dayList[0]}T00:00:00.000Z`).getTime();
  const sets = (await listSets()).filter(
    (set) => new Date(set.at).getTime() >= sinceMs
  );
  const events = await loadHistory();
  const countedEvents = new Set();
  const signals = [];

  for (const set of sets) {
    const day = dayKey(set.at);
    if (!daySet.has(day)) continue;

    const signalsMap = await loadSetSignalsMap(set);
    const snap = signalsMap?.[coinId];
    if (!snap?.isNewSignal) continue;

    const guide = await resolveSnapGuide(coinId, snap, set, settings);
    const guidelinesOk = Boolean(guide.ok);
    if (!matchesSignalKind(snap, guidelinesOk, kind)) continue;

    signals.push(await buildSignalDetailEntry(coin, snap, set, settings, guide));

    for (const event of events) {
      if (event.coinId !== coinId) continue;
      if (dayKey(event.at) !== day) continue;
      const diff = Math.abs(new Date(event.at).getTime() - new Date(set.at).getTime());
      if (diff <= 120_000) countedEvents.add(eventKey(event));
    }
  }

  const relevant = events.filter((e) => e.coinId === coinId && daySet.has(e.day));
  for (const event of relevant) {
    if (countedEvents.has(eventKey(event))) continue;
    const entry = await buildLegacySignalDetail(coin, event, sets, settings, kind);
    if (entry) signals.push(entry);
  }

  signals.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    coinId,
    coinName: coin.name,
    symbol: coin.symbol,
    kind,
    days: periodDays,
    guidelinePassPercent: 70,
    signals,
  };
}

function eventKey(event) {
  return `${event.coinId}:${event.at}`;
}

async function getSignalStats({ days = 7, coinIds = null } = {}) {
  const settings = await getSettings();
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
      if (!snap?.isNewSignal) continue;

      const guidelinesOk = await snapshotGuidelinesOk(coinId, snap, set, settings);
      countSnapshot(row, day, snap, guidelinesOk);

      // Only suppress legacy events that were already counted from this capture.
      for (const event of events) {
        if (event.coinId !== coinId) continue;
        if (dayKey(event.at) !== day) continue;
        const diff = Math.abs(new Date(event.at).getTime() - new Date(set.at).getTime());
        if (diff <= 120_000) countedEvents.add(eventKey(event));
      }
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
    guidelinePassPercent: 70,
  };
}

module.exports = {
  recordSignalEvent,
  getSignalStats,
  getSignalBarDetails,
  loadHistory,
  dayKey,
};
