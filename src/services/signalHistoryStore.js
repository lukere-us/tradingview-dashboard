const fs = require("fs/promises");
const path = require("path");
const { filterSignalEpisodes } = require("./signalMemory");
const { listSets, HISTORY_DIR } = require("./historyStore");
const { checkTradeGuidelines, buildTradeAnalysis } = require("./tradeGuidelines");
const { getSettings } = require("./settingsStore");
const { getCoins, getActiveCoins, orderCoinIds } = require("./coinsStore");
const { analyzeChartSignal, analyzeChartSignals24h, CURRENT_DIR } = require("./chartSignal");

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

  const lastActed = previous?.lastActedSignal ?? previous?.lastTradedSignal ?? null;
  if (lastActed === signal) {
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

/** UTC day keys between two timestamps (for rolling 24h windows). */
function listDaysInRange(sinceMs, untilMs = Date.now()) {
  const out = new Set();
  const cursor = new Date(sinceMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(untilMs);
  while (cursor <= end) {
    out.add(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return [...out];
}

function resolveSignalPeriod(days) {
  const periodDays = Math.min(30, Math.max(1, Number(days) || 7));
  if (periodDays <= 1) {
    const untilMs = Date.now();
    const sinceMs = untilMs - 24 * 60 * 60 * 1000;
    return {
      periodDays,
      sinceMs,
      untilMs,
      rolling24h: true,
      dayList: listDaysInRange(sinceMs, untilMs),
    };
  }
  const dayList = listDays(periodDays);
  const sinceMs = new Date(`${dayList[0]}T00:00:00.000Z`).getTime();
  return {
    periodDays,
    sinceMs,
    untilMs: Date.now(),
    rolling24h: false,
    dayList,
  };
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

async function enrichSnapFromImage(coinId, snap, set) {
  const imagePath = path.join(HISTORY_DIR, set.id, `${coinId}.png`);
  try {
    await fs.access(imagePath);
  } catch {
    return snap;
  }
  const detected = await analyzeChartSignal(imagePath);
  if (detected.signal !== "buy" && detected.signal !== "sell") {
    return snap;
  }
  return {
    ...snap,
    signal: detected.signal,
    position: detected.position,
    highlight: detected.highlight,
    isNewSignal: true,
  };
}

async function detectCaptureSignal(coinId, set) {
  const imagePath = path.join(HISTORY_DIR, set.id, `${coinId}.png`);
  try {
    await fs.access(imagePath);
  } catch {
    return null;
  }
  const detected = await analyzeChartSignal(imagePath);
  if (detected.signal !== "buy" && detected.signal !== "sell") {
    return null;
  }
  return {
    signal: detected.signal,
    position: detected.position,
    highlight: detected.highlight,
    isNewSignal: true,
    analyzedAt: set.at,
  };
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
  if (snap.signal !== "buy" && snap.signal !== "sell") return false;
  const guide = await resolveSnapGuide(coinId, snap, set, settings);
  return Boolean(guide.ok);
}

function matchesSignalKind(snap, guidelinesOk, kind) {
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
    highlight: snap.highlight || null,
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
    const rawSnap = signalsMap?.[coin.id] || {
      signal: event.signal,
      position: event.position,
      isNewSignal: true,
      analyzedAt: event.at,
    };
    const snap = await enrichSnapFromImage(coin.id, rawSnap, nearby);
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
  if (!coin || !coin.enabled) {
    return { coinId, coinName: coin?.name || coinId, kind, days, signals: [] };
  }

  const periodDays = Math.min(30, Math.max(1, Number(days) || 7));
  const period = resolveSignalPeriod(periodDays);
  const daySet = new Set(period.dayList);
  const sets = (await listSets()).filter(
    (set) => {
      const t = new Date(set.at).getTime();
      return t >= period.sinceMs && t <= period.untilMs;
    }
  );
  const events = await loadHistory();
  const signals = [];

  if (period.rolling24h) {
    const signals24 = await collectCoinSignals24h(coinId, period.untilMs, settings);
    const imagePath = path.join(CURRENT_DIR, `${coinId}.png`);

    for (const sig of signals24) {
      const snap = {
        signal: sig.signal,
        position: sig.position || null,
        highlight: sig.signal,
        analyzedAt: sig.at,
        approxTime: sig.approxTime || null,
      };
      const guide = await checkTradeGuidelines({
        coinId,
        signal: sig.signal,
        settings,
        imagePath,
      }).catch(() => null);
      const guidelinesOk = Boolean(guide?.ok);
      if (!matchesSignalKind(snap, guidelinesOk, kind)) continue;

      signals.push({
        id: `${coinId}-24h-${sig.signal}-${sig.at}`,
        coinId: coin.id,
        coinName: coin.name,
        symbol: coin.symbol,
        signal: sig.signal,
        at: sig.at,
        approxTime: sig.approxTime || null,
        position: sig.position || null,
        guidelinesOk,
        guidelinePassPercent: guide?.passStats?.percent ?? null,
        screenshotUrl: `/screenshots/current/${coin.id}.png`,
        analysis: buildTradeAnalysis({
          coinId: coin.id,
          signal: sig.signal,
          chartResult: snap,
          guide,
          settings,
        }),
      });
    }

    signals.sort((a, b) => new Date(b.at) - new Date(a.at));

    return {
      coinId,
      coinName: coin.name,
      symbol: coin.symbol,
      kind,
      days: periodDays,
      rolling24h: period.rolling24h,
      guidelinePassPercent: 70,
      signals,
    };
  }

  const episodes = await collectCoinEpisodes(
    coinId,
    sets,
    period.sinceMs,
    period.untilMs
  );

  for (const episode of episodes) {
    if (!episode.set || !episode.snap) continue;

    const guide = await resolveSnapGuide(coinId, episode.snap, episode.set, settings);
    const guidelinesOk = Boolean(guide.ok);
    if (!matchesSignalKind(episode.snap, guidelinesOk, kind)) continue;

    signals.push(
      await buildSignalDetailEntry(coin, episode.snap, episode.set, settings, guide)
    );
  }

  signals.sort((a, b) => new Date(b.at) - new Date(a.at));

  return {
    coinId,
    coinName: coin.name,
    symbol: coin.symbol,
    kind,
    days: periodDays,
    rolling24h: period.rolling24h,
    guidelinePassPercent: 70,
    signals,
  };
}

/** Rolling 24h: read all text labels from the latest chart image (matches manual count). */
async function collectCoinSignals24h(coinId, untilMs, settings) {
  const imagePath = path.join(CURRENT_DIR, `${coinId}.png`);
  const result = await analyzeChartSignals24h(imagePath, {
    captureAt: new Date(untilMs).toISOString(),
    chartInterval: settings?.chartInterval || "15",
  });
  return result.signals || [];
}

function signal24hToEpisode(sig, coinId) {
  return {
    at: sig.at,
    day: dayKey(sig.at),
    signal: sig.signal,
    approxTime: sig.approxTime || null,
    snap: {
      signal: sig.signal,
      position: sig.position || null,
      highlight: sig.signal,
      isNewSignal: true,
      analyzedAt: sig.at,
      approxTime: sig.approxTime || null,
    },
    set: null,
    coinId,
    source: "chart24h",
  };
}

/** Detect from every screenshot, run-dedupe — one count per chart label episode. */
async function collectCoinEpisodes(coinId, sets, sinceMs, untilMs) {
  const raw = [];

  for (const set of sets) {
    const atMs = new Date(set.at).getTime();
    if (atMs < sinceMs || atMs > untilMs) continue;

    const snap = await detectCaptureSignal(coinId, set);
    if (!snap) continue;

    const day = dayKey(set.at);
    raw.push({
      at: set.at,
      day,
      signal: snap.signal,
      snap,
      set,
      coinId,
      source: "capture",
    });
  }

  return filterSignalEpisodes(raw);
}

async function countEpisodeRow(coinId, episode, row, settings, guidelinesOkOverride = null) {
  if (episode.set && episode.snap) {
    const guidelinesOk =
      guidelinesOkOverride != null
        ? guidelinesOkOverride
        : await snapshotGuidelinesOk(
            coinId,
            episode.snap,
            episode.set,
            settings
          );
    countSnapshot(row, episode.day, episode.snap, guidelinesOk);
    return;
  }

  if (episode.snap && episode.source === "chart24h") {
    const guidelinesOk =
      guidelinesOkOverride != null
        ? guidelinesOkOverride
        : false;
    countSnapshot(row, episode.day, episode.snap, guidelinesOk);
    return;
  }

  if (episode.signal === "buy") {
    row.days[episode.day].buy += 1;
    row.totals.buy += 1;
  } else if (episode.signal === "sell") {
    row.days[episode.day].sell += 1;
    row.totals.sell += 1;
  }
}

async function getSignalStats({ days = 7, coinIds = null } = {}) {
  const settings = await getSettings();
  const events = await loadHistory();
  const period = resolveSignalPeriod(days);
  const daySet = new Set(period.dayList);

  const sets = (await listSets()).filter((set) => {
    const t = new Date(set.at).getTime();
    return t >= period.sinceMs && t <= period.untilMs;
  });

  const allCoins = await getActiveCoins();
  const activeIds = new Set(allCoins.map((c) => c.id));
  const coinIdSet = new Set(
    (coinIds && coinIds.length > 0
      ? coinIds
      : [
          ...new Set([
            ...events
              .filter((e) => {
                const t = new Date(e.at).getTime();
                return t >= period.sinceMs && t <= period.untilMs;
              })
              .map((e) => e.coinId),
            ...sets.flatMap((s) => (s.coins || []).map((c) => c.id)),
          ]),
        ]).filter((id) => activeIds.has(id))
  );
  const ids = orderCoinIds([...coinIdSet], allCoins);
  const byCoin = {};
  for (const id of ids) {
    byCoin[id] = initCoinRow(id, period.dayList);
  }

  for (const coinId of ids) {
    if (period.rolling24h) {
      const signals24 = await collectCoinSignals24h(
        coinId,
        period.untilMs,
        settings
      );
      for (const sig of signals24) {
        const episode = signal24hToEpisode(sig, coinId);
        if (!daySet.has(episode.day)) continue;
        const guide = await checkTradeGuidelines({
          coinId,
          signal: sig.signal,
          settings,
          imagePath: path.join(CURRENT_DIR, `${coinId}.png`),
        }).catch(() => null);
        await countEpisodeRow(
          coinId,
          episode,
          byCoin[coinId],
          settings,
          Boolean(guide?.ok)
        );
      }
      continue;
    }

    const episodes = await collectCoinEpisodes(
      coinId,
      sets,
      period.sinceMs,
      period.untilMs
    );
    for (const episode of episodes) {
      if (!daySet.has(episode.day)) continue;
      await countEpisodeRow(coinId, episode, byCoin[coinId], settings);
    }
  }

  return {
    days: period.dayList,
    periodDays: period.periodDays,
    rolling24h: period.rolling24h,
    sinceAt: new Date(period.sinceMs).toISOString(),
    untilAt: new Date(period.untilMs).toISOString(),
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
