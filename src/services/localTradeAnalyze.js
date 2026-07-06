const fs = require("fs/promises");
const path = require("path");
const { listSets, HISTORY_DIR } = require("./historyStore");
const { buildTradeAnalysis } = require("./tradeGuidelines");
const { loadHistory } = require("./signalHistoryStore");
const { getCoins } = require("./coinsStore");
const { getSettings } = require("./settingsStore");
const { futuresSymbol } = require("./binanceTrade");

const FORWARD_CAPTURES = 3;
const HOLD_CAPTURES = 2;
/** Paper trades: do not block on Future Trend Pro checklist. */
const ASSUME_GUIDELINES_PASS = true;

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function sortSetsChronological(sets) {
  return [...sets].sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** Local calendar day (matches user's Today in the UI). */
function todayLocalDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function entryLocalDayKey(iso) {
  return todayLocalDayKey(new Date(iso));
}

function startOfLocalDayMs(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-day range: Today = local midnight → now; N days = last N local calendar days. */
function sinceMsForDays(days) {
  if (days <= 1) return startOfLocalDayMs();
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

function tradeTotalsSnapshot(counts) {
  return {
    simulated: counts.simulated || 0,
    wins: counts.wins || 0,
    losses: counts.losses || 0,
    openAfter3: counts.openAfter3 || 0,
    totalPnl: counts.totalPnl || 0,
    winRate: counts.winRate ?? null,
  };
}


async function loadSetMeta(setId) {
  try {
    const raw = await fs.readFile(path.join(HISTORY_DIR, setId, "meta.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSetMeta(setId, meta) {
  await fs.writeFile(
    path.join(HISTORY_DIR, setId, "meta.json"),
    JSON.stringify(meta, null, 2)
  );
}

/** Public kline close at capture time — cached into meta.json (local after first run). */
async function fetchKlineClose(symbol, atMs) {
  const startTime = atMs - 60_000;
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${startTime}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return Number(rows[0][4]);
}

async function ensureSetPrices(set, coins) {
  if (set.prices && Object.keys(set.prices).length > 0) {
    return set.prices;
  }

  const meta = (await loadSetMeta(set.id)) || set;
  if (meta.prices && Object.keys(meta.prices).length > 0) {
    set.prices = meta.prices;
    return meta.prices;
  }

  const prices = {};
  const coinMap = Object.fromEntries(coins.map((c) => [c.id, c]));

  for (const row of set.coins || []) {
    const coin = coinMap[row.id] || row;
    const symbol = futuresSymbol(coin.symbol);
    if (!symbol) continue;

    const close = await fetchKlineClose(symbol, new Date(set.at).getTime());
    if (close > 0) prices[row.id] = close;
  }

  if (Object.keys(prices).length > 0) {
    meta.prices = prices;
    set.prices = prices;
    await saveSetMeta(set.id, meta).catch(() => {});
  }

  return prices;
}

async function resolveCaptureSignal(
  set,
  coin,
  settings,
  imagePath,
  legacyEvents = [],
  countedLegacyKeys = null
) {
  const meta = (await loadSetMeta(set.id)) || set;
  const stored = meta.signals?.[coin.id];

  if (stored) {
    if (
      !stored.isNewSignal ||
      (stored.signal !== "buy" && stored.signal !== "sell")
    ) {
      return { isNewSignal: false };
    }

    return {
      isNewSignal: true,
      signal: stored.signal,
      chartResult: {
        signal: stored.signal,
        position: stored.position,
        analyzedAt: stored.analyzedAt,
      },
      fromMeta: true,
    };
  }

  const setAt = new Date(set.at).getTime();
  const legacyEvent = legacyEvents.find(
    (event) =>
      event.coinId === coin.id &&
      (event.signal === "buy" || event.signal === "sell") &&
      Math.abs(new Date(event.at).getTime() - setAt) < 120_000
  );

  if (!legacyEvent) {
    return { isNewSignal: false };
  }

  const legacyKey = `${legacyEvent.coinId}:${legacyEvent.at}`;
  if (countedLegacyKeys?.has(legacyKey)) {
    return { isNewSignal: false };
  }
  countedLegacyKeys?.add(legacyKey);

  return {
    isNewSignal: true,
    signal: legacyEvent.signal,
    chartResult: {
      signal: legacyEvent.signal,
      position: legacyEvent.position || null,
      analyzedAt: legacyEvent.at,
    },
    fromMeta: false,
  };
}

function simulateTradeOutcome({
  signal,
  entryPrice,
  forwardPrices,
  settings,
}) {
  const leverage = Number(settings.tradeLeverage) || 10;
  const usdt = Number(settings.tradeAmountUsdt) || 2;
  const tpPct = Number(settings.tradeTpPercent) || 30;
  const slPct = Number(settings.tradeSlPercent) || 30;
  const mode = settings.tradeMode || "long_only";

  if (!entryPrice || entryPrice <= 0) {
    return { outcome: "no_price", pnlUsdt: 0, pnlPercent: 0 };
  }

  const isLong = signal === "buy";
  const isShort = signal === "sell" && mode === "reversal";

  if (signal === "sell" && mode === "long_only") {
    return { outcome: "close_only", pnlUsdt: 0, pnlPercent: 0, note: "long_only: SELL closes only" };
  }

  if (!isLong && !isShort) {
    return { outcome: "skipped", pnlUsdt: 0, pnlPercent: 0 };
  }

  let tpPrice;
  let slPrice;

  if (isLong) {
    tpPrice = entryPrice * (1 + tpPct / 100);
    slPrice = entryPrice * (1 - slPct / 100);
  } else {
    tpPrice = entryPrice * (1 - tpPct / 100);
    slPrice = entryPrice * (1 + slPct / 100);
  }

  const steps = [];
  let outcome = "open";
  let exitPrice = entryPrice;
  let exitStep = 0;

  for (let i = 0; i < forwardPrices.length; i++) {
    const price = forwardPrices[i];
    if (!price || price <= 0) {
      steps.push({ step: i + 1, price: null, status: "no_price" });
      continue;
    }

    let status = "hold";
    if (isLong) {
      if (price >= tpPrice) {
        status = "tp";
        outcome = "win_tp";
        exitPrice = tpPrice;
        exitStep = i + 1;
      } else if (price <= slPrice) {
        status = "sl";
        outcome = "loss_sl";
        exitPrice = slPrice;
        exitStep = i + 1;
      }
    } else {
      if (price <= tpPrice) {
        status = "tp";
        outcome = "win_tp";
        exitPrice = tpPrice;
        exitStep = i + 1;
      } else if (price >= slPrice) {
        status = "sl";
        outcome = "loss_sl";
        exitPrice = slPrice;
        exitStep = i + 1;
      }
    }

    steps.push({ step: i + 1, price, status });
    if (outcome === "win_tp" || outcome === "loss_sl") break;
  }

  if (outcome === "open" && forwardPrices.length > 0) {
    const last = [...forwardPrices].reverse().find((p) => p > 0);
    if (last) {
      exitPrice = last;
      exitStep = forwardPrices.length;
      outcome = "after_3";
    }
  }

  let pnlPercent;
  if (outcome === "win_tp") {
    pnlPercent = tpPct * leverage;
  } else if (outcome === "loss_sl") {
    pnlPercent = -slPct * leverage;
  } else if (isLong) {
    pnlPercent = ((exitPrice - entryPrice) / entryPrice) * leverage * 100;
  } else {
    pnlPercent = ((entryPrice - exitPrice) / entryPrice) * leverage * 100;
  }

  const pnlUsdt = (usdt * pnlPercent) / 100;

  return {
    outcome,
    exitStep,
    entryPrice: round2(entryPrice),
    exitPrice: round2(exitPrice),
    tpPrice: round2(tpPrice),
    slPrice: round2(slPrice),
    pnlUsdt: round2(pnlUsdt),
    pnlPercent: round2(pnlPercent),
    leverage,
    usdt,
    steps,
  };
}

function summarizeTodayPnl(simulations) {
  const today = todayLocalDayKey();
  const todaySims = simulations.filter(
    (s) => s.entrySet?.at && entryLocalDayKey(s.entrySet.at) === today
  );

  let wins = 0;
  let losses = 0;
  let openAfter3 = 0;
  let totalPnl = 0;

  for (const sim of todaySims) {
    const outcome = sim.simulation?.outcome;
    totalPnl += sim.simulation?.pnlUsdt || 0;
    if (outcome === "win_tp") wins++;
    else if (outcome === "loss_sl") losses++;
    else if (outcome === "after_3") openAfter3++;
  }

  return {
    simulated: todaySims.length,
    wins,
    losses,
    openAfter3,
    totalPnl: round2(totalPnl),
    winRate:
      wins + losses > 0 ? round2((wins / (wins + losses)) * 100) : null,
  };
}

async function analyzeCoinAcrossHistory(coin, sets, settings, options = {}) {
  const { onProgress } = options;
  const simulations = [];
  let lastEntryCaptureIdx = -999;
  let lastSignal = null;

  let signalsDetected = 0;
  let guidelinesPassed = 0;
  let simulated = 0;
  let wins = 0;
  let losses = 0;
  let openAfter3 = 0;
  let totalPnl = 0;
  const legacyEvents = await loadHistory();
  const countedLegacyKeys = new Set();

  for (let i = 0; i <= sets.length - FORWARD_CAPTURES - 1; i++) {
    const set = sets[i];
    const imagePath = path.join(HISTORY_DIR, set.id, `${coin.id}.png`);

    try {
      await fs.access(imagePath);
    } catch {
      continue;
    }

    onProgress?.({ coinId: coin.id, index: i, total: sets.length });

    const captured = await resolveCaptureSignal(
      set,
      coin,
      settings,
      imagePath,
      legacyEvents,
      countedLegacyKeys
    );

    if (!captured.isNewSignal) continue;
    signalsDetected++;
    guidelinesPassed++;

    const { signal, chartResult } = captured;

    if (
      lastSignal === signal &&
      i - lastEntryCaptureIdx < HOLD_CAPTURES
    ) {
      continue;
    }

    const prices = await ensureSetPrices(set, [coin]);
    const entryPrice = prices[coin.id];
    if (!entryPrice) continue;

    const forwardPrices = [];
    const forwardSets = [];
    let sim = null;

    for (let f = 1; f <= FORWARD_CAPTURES; f++) {
      const futureSet = sets[i + f];
      const futurePrices = await ensureSetPrices(futureSet, [coin]);
      forwardPrices.push(futurePrices[coin.id] || null);
      forwardSets.push({
        id: futureSet.id,
        at: futureSet.at,
        price: futurePrices[coin.id] || null,
        screenshotUrl: `/screenshots/history/${futureSet.id}/${coin.id}.png`,
      });

      sim = simulateTradeOutcome({
        signal,
        entryPrice,
        forwardPrices,
        settings,
      });

      if (sim.outcome === "win_tp" || sim.outcome === "loss_sl") {
        break;
      }
    }

    if (!sim) continue;

    if (sim.outcome === "close_only" || sim.outcome === "skipped") continue;

    simulated++;
    totalPnl += sim.pnlUsdt || 0;

    if (sim.outcome === "win_tp") wins++;
    else if (sim.outcome === "loss_sl") losses++;
    else if (sim.outcome === "after_3") openAfter3++;

    lastEntryCaptureIdx = i;
    lastSignal = signal;

    const analysis = buildTradeAnalysis({
      coinId: coin.id,
      signal,
      chartResult,
      guide: { ok: true, failures: [], assumed: ASSUME_GUIDELINES_PASS },
      settings,
    });
    analysis.guidelinesAssumed = ASSUME_GUIDELINES_PASS;
    analysis.screenshotUrl = `/screenshots/history/${set.id}/${coin.id}.png`;

    simulations.push({
      id: `${set.id}-${coin.id}-${signal}`,
      coinId: coin.id,
      coinName: coin.name,
      symbol: coin.symbol,
      signal,
      entrySet: {
        id: set.id,
        at: set.at,
        price: entryPrice,
        screenshotUrl: `/screenshots/history/${set.id}/${coin.id}.png`,
      },
      forwardSets: forwardSets.slice(0, sim.exitStep || forwardSets.length),
      simulation: sim,
      analysis,
    });
  }

  return {
    coinId: coin.id,
    coinName: coin.name,
    symbol: coin.symbol,
    counts: {
      signalsDetected,
      guidelinesPassed,
      simulated,
      wins,
      losses,
      openAfter3,
      winRate: wins + losses > 0 ? round2((wins / (wins + losses)) * 100) : null,
      totalPnl: round2(totalPnl),
    },
    simulations,
  };
}

async function runLocalTradeAnalysis(options = {}) {
  const settings = await getSettings();
  const coins = await getCoins();
  const days = Math.min(90, Math.max(1, Number(options.days) || 30));
  const coinId = options.coinId || null;
  const allSetsList = await listSets();
  const sinceMs = sinceMsForDays(days);
  const todaySinceMs = startOfLocalDayMs();

  const sets = sortSetsChronological(
    allSetsList.filter((s) => new Date(s.at).getTime() >= sinceMs)
  );
  const todaySets = sortSetsChronological(
    allSetsList.filter((s) => new Date(s.at).getTime() >= todaySinceMs)
  );

  const targetCoins = coinId
    ? coins.filter((c) => c.id === coinId)
    : coins;

  const perCoin = [];
  const totals = {
    setsAnalyzed: sets.length,
    signalsDetected: 0,
    guidelinesPassed: 0,
    simulated: 0,
    wins: 0,
    losses: 0,
    openAfter3: 0,
    totalPnl: 0,
  };

  for (const coin of targetCoins) {
    const row = await analyzeCoinAcrossHistory(coin, sets, settings, options);
    perCoin.push(row);

    totals.signalsDetected += row.counts.signalsDetected;
    totals.guidelinesPassed += row.counts.guidelinesPassed;
    totals.simulated += row.counts.simulated;
    totals.wins += row.counts.wins;
    totals.losses += row.counts.losses;
    totals.openAfter3 += row.counts.openAfter3;
    totals.totalPnl += row.counts.totalPnl;
  }

  totals.totalPnl = round2(totals.totalPnl);
  totals.winRate =
    totals.wins + totals.losses > 0
      ? round2((totals.wins / (totals.wins + totals.losses)) * 100)
      : null;

  const allSimulations = perCoin
    .flatMap((c) => c.simulations)
    .sort((a, b) => new Date(b.entrySet.at) - new Date(a.entrySet.at));

  let todayTotals;
  if (days <= 1) {
    todayTotals = tradeTotalsSnapshot(totals);
  } else {
    todayTotals = summarizeTodayPnl(allSimulations);
  }

  return {
    days,
    setsUsed: sets.length,
    todaySetsUsed: todaySets.length,
    forwardCaptures: FORWARD_CAPTURES,
    holdCaptures: HOLD_CAPTURES,
    settings: {
      tradeAmountUsdt: settings.tradeAmountUsdt,
      tradeLeverage: settings.tradeLeverage,
      tradeTpPercent: settings.tradeTpPercent,
      tradeSlPercent: settings.tradeSlPercent,
      tradeMode: settings.tradeMode,
      chartInterval: settings.chartInterval,
    },
    totals,
    todayTotals,
    perCoin,
    simulations: allSimulations,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  runLocalTradeAnalysis,
  FORWARD_CAPTURES,
  HOLD_CAPTURES,
  simulateTradeOutcome,
};
