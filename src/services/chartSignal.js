const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");

const W = 1280;
const PLOT = { left: 56, top: 82, right: 1140, bottom: 520 };

/** Indicator status table — left center of the layout (green BULL / UP text). */
const STATUS_TABLE = { left: 60, top: 130, right: 460, bottom: 400 };

/** Only accept BUY/SELL labels on the last N candles. */
const LAST_CANDLES = 3;
/** Approx candle body + gap width on 1280×720 TradingView screenshots. */
const CANDLE_WIDTH_PX = 26;
/** Horizontal span of the last 3 candles (from price axis leftward). */
const CANDLES_ZONE_WIDTH = LAST_CANDLES * CANDLE_WIDTH_PX; // ~78px

/** Future Trend Pro BUY/SELL text bars (not BreakOut/BreakDwn arrowheads). */
const MIN_TEXT_LABEL_W = 45;
const MAX_LABEL_W = 110;
const MIN_TEXT_LABEL_H = 10;
const MAX_LABEL_H = 48;
const MIN_TEXT_ASPECT = 2;
const MIN_TEXT_ROWS = 2;

const CURRENT_DIR = path.join(__dirname, "..", "..", "screenshots", "current");

/** Zone covering only the last 3 candles. */
function lastCandlesZone() {
  return {
    left: PLOT.right - CANDLES_ZONE_WIDTH,
    right: PLOT.right,
  };
}

/** @deprecated use lastCandlesZone */
function edgeZone() {
  return lastCandlesZone();
}

/** Future Trend Pro BUY label green (e.g. rgb(0,230,118)). */
function isBuyGreen(r, g, b) {
  return g >= 185 && r <= 40 && b >= 90 && b <= 145 && g > r + 100 && g > b;
}

/** Future Trend Pro SELL label red (e.g. rgb(231,22,63) / rgb(255,23,68)). */
function isSellRed(r, g, b) {
  return r >= 200 && g <= 55 && b >= 45 && b <= 95 && r > g + 120 && r > b + 80;
}

/** BreakOut arrow — yellow (small up triangle, not a BUY/SELL text bar). */
function isBreakOutYellow(r, g, b) {
  return r >= 220 && g >= 160 && b <= 90 && g >= r - 30;
}

/** BreakDwn arrow — orange (small down triangle, not a BUY/SELL text bar). */
function isBreakDwnOrange(r, g, b) {
  return r >= 230 && g >= 80 && g <= 145 && b <= 70 && r > g + 70;
}

function isChartBackground(r, g, b) {
  return r < 48 && g < 52 && b < 68;
}

function inStatusTable(x, y) {
  return (
    x >= STATUS_TABLE.left &&
    x <= STATUS_TABLE.right &&
    y >= STATUS_TABLE.top &&
    y <= STATUS_TABLE.bottom
  );
}

function boxInStatusTable(box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return inStatusTable(cx, cy);
}

function getPixel(data, channels, x, y) {
  const i = (y * W + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

function labelColor(r, g, b) {
  if (isBreakOutYellow(r, g, b) || isBreakDwnOrange(r, g, b)) return null;
  if (isBuyGreen(r, g, b)) return "buy";
  if (isSellRed(r, g, b)) return "sell";
  return null;
}

function colorMatchesType(r, g, b, type) {
  if (type === "buy") return isBuyGreen(r, g, b);
  if (type === "sell") return isSellRed(r, g, b);
  return false;
}

/** BreakOut/BreakDwn render as small arrowheads — growing span, not flat text rows. */
function isArrowMarker(data, channels, box) {
  const spans = [];

  for (let y = box.y; y < box.y + box.height; y++) {
    let maxSpan = 0;
    let run = 0;

    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (colorMatchesType(r, g, b, box.type)) {
        run++;
        maxSpan = Math.max(maxSpan, run);
      } else {
        run = 0;
      }
    }

    if (maxSpan >= 3) spans.push(maxSpan);
  }

  if (spans.length < 4) return false;

  let increases = 0;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i] > spans[i - 1]) increases++;
  }

  const decreases = spans.length - 1 - increases;
  const monotonic = Math.max(increases, decreases) / (spans.length - 1);
  return monotonic > 0.62;
}

/** BUY/SELL text bar — wide, flat rows (e.g. "BUY 8.13"), not arrow triangles. */
function isTextSignalLabel(data, channels, box) {
  if (
    box.width < MIN_TEXT_LABEL_W ||
    box.width > MAX_LABEL_W ||
    box.height < MIN_TEXT_LABEL_H ||
    box.height > MAX_LABEL_H ||
    box.width / box.height < MIN_TEXT_ASPECT
  ) {
    return false;
  }

  if (isArrowMarker(data, channels, box)) return false;

  let textRows = 0;
  const scanRows = Math.min(6, box.height);

  for (let y = box.y; y < box.y + scanRows; y++) {
    let match = 0;
    let total = 0;
    let maxSpan = 0;
    let run = 0;
    const minSpan = Math.min(28, box.width * 0.45);

    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      total++;
      if (colorMatchesType(r, g, b, box.type)) {
        match++;
        run++;
        maxSpan = Math.max(maxSpan, run);
      } else {
        run = 0;
      }
    }

    if (total > 0 && match / total >= 0.45 && maxSpan >= minSpan) {
      textRows++;
    }
  }

  return textRows >= MIN_TEXT_ROWS;
}

/** True if the label sits on the last 3 candles (not older mid-chart signals). */
function boxOnLastCandles(box, zone) {
  const centerX = box.x + box.width / 2;
  const overlapLeft = Math.max(box.x, zone.left);
  const overlapRight = Math.min(box.x + box.width, zone.right);
  const overlap = Math.max(0, overlapRight - overlapLeft);
  const overlapRatio = box.width > 0 ? overlap / box.width : 0;

  // Center must sit on a last-3 candle (not an indicator line bleeding in from the left).
  const centerOnCandles =
    centerX >= zone.left - 10 && centerX <= zone.right + 6;

  return centerOnCandles && overlapRatio >= 0.35;
}

function mergeBoxes(boxes) {
  const merged = [];

  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hit = merged.find(
      (m) =>
        m.type === box.type &&
        Math.abs(m.x - box.x) < 55 &&
        box.y <= m.y + m.height + 6 &&
        box.y >= m.y - 6
    );

    if (hit) {
      const right = Math.max(hit.x + hit.width, box.x + box.width);
      hit.y = Math.min(hit.y, box.y);
      hit.height = Math.max(hit.y + hit.height, box.y + box.height) - hit.y;
      hit.x = Math.min(hit.x, box.x);
      hit.width = right - hit.x;
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

async function analyzeChartSignal(imagePath) {
  try {
    await fs.access(imagePath);
  } catch {
    return { signal: "none", position: null, highlight: null };
  }

  const { data, info } = await sharp(imagePath)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const zone = lastCandlesZone();
  // Labels on the last 3 candles extend at most ~half their width left of the zone.
  const scanLeft = Math.max(PLOT.left, zone.left - Math.ceil(MAX_LABEL_W / 2));
  const candleYs = [];

  // Candle bodies only inside the last-3-candles strip (for top/bottom).
  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    for (let x = zone.left; x < zone.right; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (labelColor(r, g, b) || isChartBackground(r, g, b)) continue;
      if (r + g + b < 70) continue;
      candleYs.push(y);
    }
  }

  const rowBoxes = [];
  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    let runStart = null;
    let runType = null;

    // Scan last 3 candles + pad so full "BUY/SELL + price" labels are captured.
    for (let x = scanLeft; x < zone.right; x++) {
      if (inStatusTable(x, y)) continue;

      const [r, g, b] = getPixel(data, channels, x, y);
      const type = labelColor(r, g, b);

      if (type === runType && type) continue;

      if (runType && runStart != null) {
        const width = x - runStart;
        if (width >= 6) {
          rowBoxes.push({ type: runType, x: runStart, y, width, height: 1 });
        }
      }

      runStart = type ? x : null;
      runType = type;
    }
  }

  const labels = mergeBoxes(rowBoxes).filter(
    (b) =>
      !boxInStatusTable(b) &&
      isTextSignalLabel(data, channels, b) &&
      boxOnLastCandles(b, zone)
  );

  if (labels.length === 0) {
    return { signal: "none", position: null, highlight: null };
  }

  // Prefer the rightmost label (newest of the last 3 candles).
  const latest = labels.reduce((best, box) =>
    box.x + box.width > best.x + best.width ? box : best
  );

  // Future Trend Pro draws BUY under candles and SELL above them.
  // Prefer geometry when candles are clear; fall back to indicator convention.
  let position = latest.type === "buy" ? "bottom" : "top";

  if (candleYs.length > 0) {
    const candleTop = Math.min(...candleYs);
    const candleBottom = Math.max(...candleYs);
    const candleMid = (candleTop + candleBottom) / 2;
    const labelCenterY = latest.y + latest.height / 2;
    const geometric = labelCenterY >= candleMid ? "bottom" : "top";

    // Trust geometry only when it matches the indicator convention.
    if (
      (latest.type === "buy" && geometric === "bottom") ||
      (latest.type === "sell" && geometric === "top")
    ) {
      position = geometric;
    }
  }

  const highlight =
    (latest.type === "buy" && position === "bottom") ||
    (latest.type === "sell" && position === "top")
      ? latest.type
      : "mixed";

  return {
    signal: latest.type,
    position,
    highlight,
  };
}

async function analyzeCoinSignal(coinId) {
  const imagePath = path.join(CURRENT_DIR, `${coinId}.png`);
  const result = await analyzeChartSignal(imagePath);
  return { coinId, ...result, analyzedAt: new Date().toISOString() };
}

async function analyzeCoins(coinIds) {
  const results = {};
  for (const coinId of coinIds) {
    results[coinId] = await analyzeCoinSignal(coinId);
  }
  return results;
}

module.exports = {
  analyzeChartSignal,
  analyzeCoinSignal,
  analyzeCoins,
  lastCandlesZone,
  edgeZone,
  STATUS_TABLE,
  LAST_CANDLES,
};
