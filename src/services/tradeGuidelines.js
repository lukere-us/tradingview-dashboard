const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");

const W = 1280;

/** Search band for the Future Trend Pro status table (left center of screenshot). */
const TABLE_SEARCH = {
  topMin: 200,
  topMax: 320,
  leftMin: 140,
  leftMax: 250,
  width: 250,
  rowHeight: 20,
  headerHeight: 24,
  valueOffset: 100,
};

const ROW_KEYS = ["bias", "supertrend", "macd", "adx", "vwap", "emaCloud"];

const ROW_LABELS = {
  bias: "Bias",
  supertrend: "Supertrend",
  macd: "MACD",
  adx: "ADX (20+)",
  vwap: "VWAP",
  emaCloud: "EMA Cloud",
};

/** Minimum checklist completion to treat guidelines as passed. */
const GUIDELINE_PASS_PERCENT = 70;

function checklistPassStats(checklist) {
  const items = Array.isArray(checklist) ? checklist : [];
  const total = items.length;
  const passed = items.filter((i) => i.passed).length;
  const percent = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;

  return {
    passed,
    total,
    percent,
    ok: total > 0 && percent >= GUIDELINE_PASS_PERCENT,
  };
}

/** Recompute pass stats from saved trade/analysis checklist (core rows only). */
function guidelineStatsFromAnalysis(analysis) {
  if (!analysis) {
    return { passed: 0, total: 0, percent: null, ok: false };
  }

  if (analysis.guidelinePassStats) {
    return analysis.guidelinePassStats;
  }

  const full = Array.isArray(analysis.checklist) ? analysis.checklist : [];
  const core = full.filter((i) => i.key !== "signal");
  const checklist = core.length > 0 ? core : full;

  if (!checklist.length) {
    const percent = analysis.guidelinePassPercent ?? null;
    return {
      passed: 0,
      total: 0,
      percent,
      ok:
        percent != null
          ? percent >= GUIDELINE_PASS_PERCENT
          : Boolean(analysis.guidelinesPassed),
    };
  }

  return checklistPassStats(checklist);
}

function enrichTradeJournalEntry(trade) {
  if (!trade?.analysis) return trade;
  const passStats = guidelineStatsFromAnalysis(trade.analysis);
  return {
    ...trade,
    analysis: {
      ...trade.analysis,
      guidelinePassPercent: passStats.percent,
      guidelinesPassed: passStats.ok,
      guidelinePassStats: passStats,
    },
  };
}

/** Trade Journal only includes signals that met the guideline threshold. */
function tradeJournalGuidelinesPassed(trade) {
  const enriched = enrichTradeJournalEntry(trade);
  return enriched.analysis?.guidelinesPassed === true;
}

/** Future Trend Pro [15m] trading guide — checklist before entry. */
const BUY_REQUIREMENTS = {
  bias: { value: "green", label: "Bias must be BULLISH (not NEUTRAL)" },
  supertrend: { value: "green", label: "Supertrend must be UP" },
  macd: { value: "green", label: "MACD must be BULL" },
  adx: { value: "green", label: "ADX must be 20+ (green in table)" },
  vwap: { value: "green", label: "VWAP must be Above price" },
  emaCloud: { value: "green", label: "EMA Cloud must be BULL" },
};

const SELL_REQUIREMENTS = {
  bias: { value: "red", label: "Bias must be BEARISH (not NEUTRAL)" },
  supertrend: { value: "red", label: "Supertrend must be DOWN" },
  macd: { value: "red", label: "MACD must be BEAR" },
  adx: { value: "green", label: "ADX must be 20+ (green in table)" },
  vwap: { value: "red", label: "VWAP must be Below price" },
  emaCloud: { value: "red", label: "EMA Cloud must be BEAR" },
};

function isBrightGreen(r, g, b) {
  return g >= 170 && r <= 60 && g > r + 80 && g > b;
}

function isBrightRed(r, g, b) {
  return r >= 200 && g <= 70 && r > g + 100;
}

function isNeutralGray(r, g, b) {
  return (
    r >= 130 &&
    r <= 210 &&
    g >= 130 &&
    g <= 210 &&
    b >= 130 &&
    b <= 210 &&
    Math.abs(r - g) < 30
  );
}

function getPixel(data, channels, x, y) {
  const i = (y * W + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

function rowStatusColor(data, channels, box, rowIndex = -1) {
  let green = 0;
  let red = 0;
  let gray = 0;
  const valueLeft = box.left + TABLE_SEARCH.valueOffset;

  for (let y = box.top; y < box.bottom; y++) {
    for (let x = valueLeft; x < box.right; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (isBrightGreen(r, g, b)) green++;
      else if (isBrightRed(r, g, b)) red++;
      else if (isNeutralGray(r, g, b)) gray++;
    }
  }

  // Bias row: NEUTRAL shows as gray text in the table.
  if (rowIndex === 0 && gray >= 6 && gray >= green && gray >= red) {
    return "gray";
  }

  if (green >= red && green >= gray && green >= 4) return "green";
  if (red > green && red >= gray && red >= 4) return "red";
  if (gray >= 6) return "gray";
  return "unknown";
}

function parseRowsAt(data, channels, top, left) {
  const { width, rowHeight, headerHeight } = TABLE_SEARCH;
  const rows = {};

  for (let i = 0; i < ROW_KEYS.length; i++) {
    const y0 = top + headerHeight + i * rowHeight;
    rows[ROW_KEYS[i]] = rowStatusColor(data, channels, {
      left,
      right: left + width,
      top: y0,
      bottom: y0 + rowHeight,
    }, i);
  }

  return rows;
}

function scoreTableCandidate(rows) {
  const known = ROW_KEYS.filter((k) => rows[k] !== "unknown").length;
  const greens = ROW_KEYS.filter((k) => rows[k] === "green").length;
  const reds = ROW_KEYS.filter((k) => rows[k] === "red").length;
  const grays = ROW_KEYS.filter((k) => rows[k] === "gray").length;

  let score = known * 40;
  if (greens > 0 && reds > 0) score += 35;
  if (grays > 0) score += 15;
  if (greens >= 5 || reds >= 5) score += 20;
  return score;
}

function detectStatusTable(data, channels) {
  const { topMin, topMax, leftMin, leftMax } = TABLE_SEARCH;
  let best = null;

  for (let top = topMin; top <= topMax; top += 2) {
    for (let left = leftMin; left <= leftMax; left += 2) {
      const rows = parseRowsAt(data, channels, top, left);
      const score = scoreTableCandidate(rows);
      if (!best || score > best.score) {
        best = { top, left, rows, score };
      }
    }
  }

  if (!best || best.score < 120) {
    return { found: false, rows: null, position: null, score: best?.score || 0 };
  }

  const known = ROW_KEYS.filter((k) => best.rows[k] !== "unknown").length;
  if (known < 4) {
    return { found: false, rows: best.rows, position: best, score: best.score };
  }

  return {
    found: true,
    rows: best.rows,
    position: { top: best.top, left: best.left },
    score: best.score,
  };
}

/**
 * Read the Future Trend Pro status table from a chart screenshot.
 */
async function parseStatusTable(imagePath) {
  try {
    await fs.access(imagePath);
  } catch {
    return { found: false, rows: null, position: null, score: 0 };
  }

  const { data, info } = await sharp(imagePath)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  return detectStatusTable(data, info.channels);
}

/** True when screenshot shows a readable Future Trend Pro status table. */
async function isScreenshotChartReady(imagePath) {
  const tableResult = await parseStatusTable(imagePath);
  if (!tableResult.found) {
    return { ready: false, reason: "indicator-table-not-found", tableResult };
  }
  return { ready: true, tableResult };
}

function isFifteenMinuteChart(settings) {
  const interval = String(settings?.chartInterval || "15").trim().toUpperCase();
  return interval === "15";
}

/**
 * Validate Future Trend Pro trading guide checklist before auto-trade.
 * @see FutureTrendPro_Trading_Guide — all 5 conditions + Bias must agree.
 */
function validateTradeGuidelines(signal, tableResult, settings = {}) {
  const failures = [];
  const rows = tableResult?.rows || {};
  const status = {
    found: Boolean(tableResult?.found),
    rows,
    position: tableResult?.position || null,
  };

  if (signal !== "buy" && signal !== "sell") {
    return { ok: false, failures: ["No BUY/SELL signal"], status };
  }

  if (settings.autoTradeRequireGuidelines === false) {
    const checklist = buildChecklist(signal, tableResult, settings);
    const passStats = checklistPassStats(checklist);
    return { ok: true, failures: [], status, skippedCheck: true, checklist, passStats };
  }

  if (!isFifteenMinuteChart(settings)) {
    failures.push("Chart interval must be 15m (indicator optimized for 15-minute)");
  }

  if (!tableResult?.found) {
    failures.push("Status table not detected on screenshot");
    const checklist = buildChecklist(signal, tableResult, settings);
    const passStats = checklistPassStats(checklist);
    return { ok: passStats.ok, failures, status, checklist, passStats };
  }

  if (rows.bias === "gray" || rows.bias === "unknown") {
    failures.push("Bias is NEUTRAL — do not trade");
  }

  if (rows.adx !== "green") {
    failures.push("ADX below 20 (weak trend) — do not trade");
  }

  const requirements = signal === "buy" ? BUY_REQUIREMENTS : SELL_REQUIREMENTS;

  for (const [key, rule] of Object.entries(requirements)) {
    if (key === "bias" || key === "adx") continue;
    const actual = rows[key];
    if (actual === "unknown") {
      failures.push(`${rule.label} (not readable on table)`);
    } else if (actual !== rule.value) {
      failures.push(rule.label);
    }
  }

  if (signal === "buy" && rows.bias !== "green") {
    if (rows.bias !== "gray" && rows.bias !== "unknown") {
      failures.push(BUY_REQUIREMENTS.bias.label);
    }
  }

  if (signal === "sell" && rows.bias !== "red") {
    if (rows.bias !== "gray" && rows.bias !== "unknown") {
      failures.push(SELL_REQUIREMENTS.bias.label);
    }
  }

  const checklist = buildChecklist(signal, tableResult, settings);
  const passStats = checklistPassStats(checklist);

  return {
    ok: passStats.ok,
    failures,
    status,
    checklist,
    passStats,
  };
}

async function checkTradeGuidelines({ coinId, signal, settings, imagePath }) {
  const screenshotPath =
    imagePath ||
    path.join(__dirname, "..", "..", "screenshots", "current", `${coinId}.png`);

  const tableResult = await parseStatusTable(screenshotPath);
  const validation = validateTradeGuidelines(signal, tableResult, settings);

  return {
    ...validation,
    tableResult,
  };
}

function statusDisplay(key, color) {
  if (color === "unknown") return "—";
  if (color === "gray") return key === "bias" ? "NEUTRAL" : "Weak";
  if (key === "bias") return color === "green" ? "BULLISH" : "BEARISH";
  if (key === "supertrend") return color === "green" ? "UP" : "DOWN";
  if (key === "macd") return color === "green" ? "BULL" : "BEAR";
  if (key === "adx") return color === "green" ? "20+" : "< 20";
  if (key === "vwap") return color === "green" ? "Above" : "Below";
  if (key === "emaCloud") return color === "green" ? "BULL" : "BEAR";
  return color;
}

function requiredDisplay(key, signal) {
  if (key === "adx") return "20+ (green)";
  if (key === "bias") return signal === "buy" ? "BULLISH" : "BEARISH";
  if (key === "supertrend") return signal === "buy" ? "UP" : "DOWN";
  if (key === "macd") return signal === "buy" ? "BULL" : "BEAR";
  if (key === "vwap") return signal === "buy" ? "Above" : "Below";
  if (key === "emaCloud") return signal === "buy" ? "BULL" : "BEAR";
  return "—";
}

function rowPassed(key, actual, signal) {
  if (actual === "unknown") return false;
  if (key === "adx") return actual === "green";
  if (key === "bias") {
    if (actual === "gray") return false;
    return signal === "buy" ? actual === "green" : actual === "red";
  }
  const requirements = signal === "buy" ? BUY_REQUIREMENTS : SELL_REQUIREMENTS;
  return actual === requirements[key]?.value;
}

/** Future Trend Pro guide checklist for UI and trade journal. */
function buildChecklist(signal, tableResult, settings = {}) {
  const rows = tableResult?.rows || {};
  const items = [];

  items.push({
    key: "interval",
    label: "Chart interval",
    required: "15m",
    actual: `${settings.chartInterval || "15"}m`,
    passed: isFifteenMinuteChart(settings),
  });

  items.push({
    key: "table",
    label: "Status table",
    required: "Detected on screenshot",
    actual: tableResult?.found ? "Found" : "Not found",
    passed: Boolean(tableResult?.found),
  });

  for (const key of ROW_KEYS) {
    const actual = rows[key] || "unknown";
    items.push({
      key,
      label: ROW_LABELS[key],
      required: requiredDisplay(key, signal),
      actual: statusDisplay(key, actual),
      actualColor: actual,
      passed: rowPassed(key, actual, signal),
    });
  }

  return items;
}

function buildTradeAnalysis({
  coinId,
  signal,
  chartResult,
  guide,
  settings,
}) {
  const checklist = [...(guide?.checklist || buildChecklist(signal, guide?.tableResult, settings))];

  const chartSig = chartResult?.signal || "none";
  checklist.push({
    key: "signal",
    label: "BUY/SELL label",
    required: `${signal.toUpperCase()} on last 3 candles`,
    actual:
      chartSig === "none"
        ? "None"
        : `${chartSig.toUpperCase()}${chartResult?.position ? ` (${chartResult.position})` : ""}`,
    passed: chartSig === signal,
  });

  return {
    chartSignal: {
      signal: chartResult?.signal || "none",
      position: chartResult?.position || null,
      highlight: chartResult?.highlight || null,
      analyzedAt: chartResult?.analyzedAt || null,
    },
    screenshotUrl: `/screenshots/current/${coinId}.png`,
    guidelinesPassed: Boolean(guide?.ok),
    guidelinePassPercent: guide?.passStats?.percent ?? null,
    guidelineFailures: guide?.failures || [],
    tableFound: Boolean(guide?.tableResult?.found),
    tableStatus: guide?.tableResult?.rows || null,
    checklist,
    tradeSettings: {
      chartInterval: settings?.chartInterval || "15",
      autoTradeRequireGuidelines: settings?.autoTradeRequireGuidelines !== false,
      tradeAmountUsdt: settings?.tradeAmountUsdt,
      tradeLeverage: settings?.tradeLeverage,
      tradeMarginType: settings?.tradeMarginType,
      tradeMode: settings?.tradeMode,
      tradeTpPercent: settings?.tradeTpPercent,
      tradeSlPercent: settings?.tradeSlPercent,
      testnet: Boolean(settings?.binanceTestnet),
    },
    guideSummary:
      signal === "buy"
        ? "BUY: Bias BULLISH, Supertrend UP, MACD BULL, ADX 20+, VWAP Above, EMA BULL"
        : "SELL: Bias BEARISH, Supertrend DOWN, MACD BEAR, ADX 20+, VWAP Below, EMA BEAR",
  };
}

module.exports = {
  parseStatusTable,
  isScreenshotChartReady,
  validateTradeGuidelines,
  checkTradeGuidelines,
  buildChecklist,
  checklistPassStats,
  guidelineStatsFromAnalysis,
  enrichTradeJournalEntry,
  tradeJournalGuidelinesPassed,
  buildTradeAnalysis,
  statusDisplay,
  TABLE_SEARCH,
  ROW_KEYS,
  ROW_LABELS,
  BUY_REQUIREMENTS,
  SELL_REQUIREMENTS,
  GUIDELINE_PASS_PERCENT,
};
