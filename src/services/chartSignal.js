const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");

const SCREENSHOTS_DIR = path.join(__dirname, "..", "..", "screenshots");
const CURRENT_DIR = path.join(SCREENSHOTS_DIR, "current");

const W = 1280;
const H = 720;
const PLOT = { left: 56, top: 82, right: 1140, bottom: 520 };

/** Hours visible on a 15m chart at default TradingView zoom (~176 candles). */
const VISIBLE_HOURS_15M = 44.5;
const HOURS_24H = 24;
const CANDLES_24H_15M = 96;
/** Min horizontal gap between distinct labels (px). */
const LABEL_DEDUPE_GAP_PX = 42;

/** Indicator status table — left center of the layout (green BULL / UP text). */
const STATUS_TABLE = { left: 60, top: 130, right: 460, bottom: 400 };

/** Only accept BUY/SELL labels on the last N candles. */
const LAST_CANDLES = 3;
/** Approx candle body + gap width on 1280×720 TradingView screenshots. */
const CANDLE_WIDTH_PX = 26;
/** Horizontal span of the last 3 candles (from price axis leftward). */
const CANDLES_ZONE_WIDTH = LAST_CANDLES * CANDLE_WIDTH_PX; // ~78px

/** Future Trend Pro BUY/SELL text bars (not BreakOut/BreakDwn arrowheads). */
const MIN_TEXT_LABEL_W = 40;
const MAX_LABEL_W = 150;
const MIN_TEXT_LABEL_H = 10;
const MAX_LABEL_H = 56;
const MIN_TEXT_ASPECT = 1.35;
const MIN_TEXT_ROWS = 2;
/** White "BUY"/"SELL" + price text inside the label bar. */
const MIN_PRICE_TEXT_W = 28;

function buildScanMarkers(zone, scanLeft, scanRight, labelBox = null, accepted = false) {
  const markers = {
    imageWidth: W,
    imageHeight: H,
    lastCandles: {
      left: zone.left,
      top: PLOT.top,
      right: zone.right,
      bottom: PLOT.bottom,
    },
    scanArea: {
      left: scanLeft,
      top: PLOT.top,
      right: scanRight,
      bottom: PLOT.bottom,
    },
    labelBox: null,
  };

  if (labelBox) {
    markers.labelBox = {
      x: labelBox.x,
      y: labelBox.y,
      width: labelBox.width,
      height: labelBox.height,
      signal: labelBox.type || null,
      accepted: Boolean(accepted),
    };
  }

  return markers;
}

function emptySignalResult(zone, scanLeft, scanRight) {
  return {
    signal: "none",
    position: null,
    highlight: null,
    markers: buildScanMarkers(zone, scanLeft, scanRight),
  };
}

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

/** Dark maroon fill inside SELL tooltips when the border renders brighter than the body. */
function isSellLabelBody(r, g, b) {
  return (
    r >= 28 &&
    r <= 70 &&
    g >= 12 &&
    g <= 45 &&
    b >= 22 &&
    b <= 55 &&
    r > g &&
    r + g + b >= 70
  );
}

function isSellPixel(r, g, b) {
  return isSellRed(r, g, b) || isSellLabelBody(r, g, b);
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

function plotWidth() {
  return PLOT.right - PLOT.left;
}

function visibleHoursForInterval(chartInterval) {
  const minutes = Number(chartInterval) || 15;
  if (minutes === 15) return VISIBLE_HOURS_15M;
  return (plotWidth() / 6.1) * (minutes / 60);
}

/** Left x of the rolling 24h window (right edge = capture time). */
function window24hLeftX(visibleHours = VISIBLE_HOURS_15M) {
  const ratio = Math.min(1, HOURS_24H / visibleHours);
  return Math.round(PLOT.right - plotWidth() * ratio);
}

/** Map label center-x to approximate signal time (right edge = captureAt). */
function labelXToTime(centerX, captureAtMs, visibleHours = VISIBLE_HOURS_15M) {
  const hoursFromRight = ((PLOT.right - centerX) / plotWidth()) * visibleHours;
  return new Date(captureAtMs - hoursFromRight * 3_600_000);
}

function formatApproxTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `~${hh}:${mm} on the ${d.getDate()}`;
}

async function loadChartPixels(imagePath) {
  const { data, info } = await sharp(imagePath)
    .resize(W, H, { fit: "fill" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
}

/** Bright Future Trend Pro bar colors only (avoids bear-zone maroon flood on full chart). */
function brightLabelColor(r, g, b) {
  if (isBuyGreen(r, g, b)) return "buy";
  if (isSellRed(r, g, b)) return "sell";
  return null;
}

function countBrightLabelPixels(data, channels, box, type) {
  let count = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (type === "buy" && isBuyGreen(r, g, b)) count++;
      if (type === "sell" && isSellRed(r, g, b)) count++;
    }
  }
  return count;
}

function collectBrightRowRuns(data, channels, scanLeft, scanRight) {
  const rows = [];

  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    let runStart = null;
    let runType = null;

    for (let x = scanLeft; x < scanRight; x++) {
      if (inStatusTable(x, y)) {
        if (runType && runStart != null) {
          const width = x - runStart;
          if (width >= 3) {
            rows.push({ type: runType, x: runStart, y, width, height: 1 });
          }
        }
        runStart = null;
        runType = null;
        continue;
      }
      const [r, g, b] = getPixel(data, channels, x, y);
      const type = brightLabelColor(r, g, b);

      if (type === runType && type) continue;

      if (runType && runStart != null) {
        const width = x - runStart;
        if (width >= 3) {
          rows.push({ type: runType, x: runStart, y, width, height: 1 });
        }
      }

      runStart = type ? x : null;
      runType = type;
    }

    if (runType && runStart != null) {
      const width = scanRight - runStart;
      if (width >= 3) {
        rows.push({ type: runType, x: runStart, y, width, height: 1 });
      }
    }
  }

  return rows;
}

/** Stack thin JPEG-compressed rows into one label bounding box. */
function stackRowRunsIntoBoxes(rows) {
  const sorted = [...rows].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters = [];

  for (const row of sorted) {
    let cluster = clusters.find((c) => {
      if (c.type !== row.type) return false;
      if (row.y - c.maxY > 10) return false;
      const overlapLeft = Math.max(c.minX, row.x);
      const overlapRight = Math.min(c.maxX, row.x + row.width);
      const overlap = Math.max(0, overlapRight - overlapLeft);
      const minW = Math.min(c.maxX - c.minX, row.width);
      return minW > 0 && overlap / minW >= 0.35;
    });

    if (!cluster) {
      clusters.push({
        type: row.type,
        minX: row.x,
        maxX: row.x + row.width,
        minY: row.y,
        maxY: row.y,
      });
      continue;
    }

    cluster.minX = Math.min(cluster.minX, row.x);
    cluster.maxX = Math.max(cluster.maxX, row.x + row.width);
    cluster.minY = Math.min(cluster.minY, row.y);
    cluster.maxY = Math.max(cluster.maxY, row.y);
  }

  return clusters.map((c) => ({
    type: c.type,
    x: c.minX,
    y: c.minY,
    width: c.maxX - c.minX,
    height: c.maxY - c.minY + 1,
  }));
}

function labelAspectOk(box) {
  const ratio = box.width / Math.max(box.height, 1);
  const maxRatio = box.height <= 12 ? 20 : 8;
  return ratio >= 0.55 && ratio <= maxRatio;
}

/** Future Trend Pro BUY/SELL text bar anywhere on the chart (not last-candles only). */
function isHistoricalTextLabel(data, channels, box) {
  if (boxInStatusTable(box)) return false;
  if (box.type === "buy" && box.y > PLOT.top + 280) return false;
  if (box.y + box.height > PLOT.bottom) return false;
  if (box.width < 28 || box.width > MAX_LABEL_W) return false;
  if (box.height < 3 || box.height > MAX_LABEL_H) return false;
  if (!labelAspectOk(box)) return false;

  const brightPx = countBrightLabelPixels(data, channels, box, box.type);
  const textW = maxWhiteTextWidth(data, channels, box);
  const hasText = textW >= 18;
  const hasBrightBar = brightPx >= 45 && box.width >= 28;

  if (!hasText && !hasBrightBar) return false;
  if (isArrowMarker(data, channels, box) && !(hasText || brightPx >= 100)) {
    return false;
  }
  return true;
}

function findWideBrightRowLabels(data, channels, scanLeft, scanRight) {
  const rows = mergeHorizontalRowRuns(
    collectBrightRowRuns(data, channels, scanLeft, scanRight)
  ).filter((row) => row.width >= 40 && row.width <= MAX_LABEL_W);

  return rows.map((row) => ({
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: Math.max(row.height || 1, 12),
  }));
}

function unionLabelBoxes(...lists) {
  const all = lists.flat();
  return dedupeChartLabels(
    all.map((box) => ({
      ...box,
      centerX: box.x + box.width / 2,
    }))
  ).sort((a, b) => a.centerX - b.centerX);
}

function getChartLabelCandidates(data, channels) {
  const scanLeft = PLOT.left;
  const scanRight = PLOT.right;
  const rows = mergeHorizontalRowRuns(
    collectBrightRowRuns(data, channels, scanLeft, scanRight)
  ).filter((row) => row.width >= 12);
  const stacked = stackRowRunsIntoBoxes(rows);
  const wideRows = findWideBrightRowLabels(data, channels, scanLeft, scanRight);
  return unionLabelBoxes(stacked, wideRows);
}

function findAllChartTextLabels(data, channels) {
  const candidates = getChartLabelCandidates(data, channels);

  return candidates
    .filter((box) => isHistoricalTextLabel(data, channels, box))
    .map((box) => {
      const classified = classifyLabelBox(data, channels, box);
      const buyBright = countBrightLabelPixels(data, channels, box, "buy");
      const sellBright = countBrightLabelPixels(data, channels, box, "sell");
      let type = box.type;
      if (classified === "buy" || classified === "sell") {
        type = classified;
      }
      if (sellBright > buyBright + 20) type = "sell";
      if (buyBright > sellBright + 20) type = "buy";
      return {
        ...box,
        type,
        centerX: box.x + box.width / 2,
      };
    })
    .filter((box) => box.type === "buy" || box.type === "sell")
    .sort((a, b) => a.centerX - b.centerX);
}

/** Drop labels at nearly the same x (fragmented pixels), keep distinct episodes. */
function dedupeChartLabels(labels, minGapPx = LABEL_DEDUPE_GAP_PX) {
  const sorted = [...labels].sort((a, b) => a.centerX - b.centerX);
  const kept = [];

  for (const label of sorted) {
    const gapPx = label.type === "buy" ? 140 : minGapPx;
    const yLimit = label.type === "buy" ? 400 : 35;
    const dupIdx = kept.findIndex(
      (k) =>
        k.type === label.type &&
        Math.abs(k.centerX - label.centerX) < gapPx &&
        Math.abs(k.y - label.y) <= yLimit
    );

    if (dupIdx === -1) {
      kept.push(label);
      continue;
    }

    const dup = kept[dupIdx];
    const labelArea = label.width * label.height;
    const dupArea = dup.width * dup.height;
    if (label.y < dup.y || (label.y === dup.y && labelArea < dupArea)) {
      kept[dupIdx] = label;
    }
  }

  return kept;
}

function filterLabelsIn24h(labels, visibleHours = VISIBLE_HOURS_15M) {
  const sinceX = window24hLeftX(visibleHours);
  return labels.filter((label) => label.centerX >= sinceX);
}

function labelPosition(box, data, channels) {
  const priceY = findPriceLineY(data, channels);
  const cy = box.y + box.height / 2;
  if (priceY != null) {
    return cy < priceY - 8 ? "top" : "bottom";
  }
  return box.type === "buy" ? "bottom" : "top";
}

/**
 * Find Future Trend Pro text labels (BUY/SELL + price) in the rolling 24h window.
 * Matches manual chart counting: scan full image, map x → time, dedupe by position.
 */
async function analyzeChartSignals24h(imagePath, options = {}) {
  const chartInterval = options.chartInterval || "15";
  const visibleHours = options.visibleHours || visibleHoursForInterval(chartInterval);
  const captureAtMs = options.captureAt
    ? new Date(options.captureAt).getTime()
    : Date.now();

  const empty = {
    signals: [],
    totals: { buy: 0, sell: 0 },
    window: {
      hours: HOURS_24H,
      visibleHours,
      sinceX: window24hLeftX(visibleHours),
      captureAt: new Date(captureAtMs).toISOString(),
    },
  };

  try {
    await fs.access(imagePath);
  } catch {
    return empty;
  }

  const { data, channels } = await loadChartPixels(imagePath);
  const allLabels = findAllChartTextLabels(data, channels);
  const inWindow = filterLabelsIn24h(allLabels, visibleHours);
  const unique = dedupeChartLabels(inWindow);

  const signals = unique.map((box, index) => {
    const at = labelXToTime(box.centerX, captureAtMs, visibleHours);
    return {
      index: index + 1,
      signal: box.type,
      position: labelPosition(box, data, channels),
      at: at.toISOString(),
      approxTime: formatApproxTime(at),
      centerX: Math.round(box.centerX),
      box: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
    };
  });

  return {
    signals,
    totals: {
      buy: signals.filter((s) => s.signal === "buy").length,
      sell: signals.filter((s) => s.signal === "sell").length,
    },
    window: empty.window,
  };
}

function labelColor(r, g, b) {
  if (isBreakOutYellow(r, g, b) || isBreakDwnOrange(r, g, b)) return null;
  if (isBuyGreen(r, g, b)) return "buy";
  if (isSellPixel(r, g, b)) return "sell";
  return null;
}

function colorMatchesType(r, g, b, type) {
  if (type === "buy") return isBuyGreen(r, g, b);
  if (type === "sell") return isSellPixel(r, g, b);
  return false;
}

function hasSellBorderAccent(data, channels, box) {
  let count = 0;
  const pad = 2;

  for (let y = box.y - pad; y < box.y + box.height + pad; y++) {
    for (let x = box.x - pad; x < box.x + box.width + pad; x++) {
      if (x < 0 || y < 0 || x >= W || y >= PLOT.bottom) continue;
      const [r, g, b] = getPixel(data, channels, x, y);
      if (isSellRed(r, g, b)) count++;
    }
  }

  return count >= 8;
}

/** Cyan current-price marker on the right price scale. */
function findPriceLineY(data, channels) {
  const ys = [];
  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    for (let x = PLOT.right - 4; x < W - 1; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (b >= 175 && g >= 130 && r <= 120 && b >= g) ys.push(y);
    }
  }
  if (!ys.length) return null;
  return Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
}

function isCompactLabelBox(box) {
  return (
    box.width >= MIN_TEXT_LABEL_W &&
    box.width <= MAX_LABEL_W &&
    box.height >= MIN_TEXT_LABEL_H &&
    box.height <= MAX_LABEL_H
  );
}

/** Read BUY vs SELL from bright label pixels inside the box (not chart shading). */
function classifyLabelBox(data, channels, box) {
  let buyCount = 0;
  let sellBright = 0;
  let whiteWidths = [];

  for (let y = box.y; y < box.y + box.height; y++) {
    let whiteMin = Infinity;
    let whiteMax = -Infinity;
    let whiteN = 0;

    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (isBuyGreen(r, g, b)) buyCount++;
      if (isSellRed(r, g, b)) sellBright++;
      if (r > 205 && g > 205 && b > 205) {
        whiteN++;
        whiteMin = Math.min(whiteMin, x);
        whiteMax = Math.max(whiteMax, x);
      }
    }

    if (whiteN >= 8) whiteWidths.push(whiteMax - whiteMin);
  }

  const textWidth = whiteWidths.length ? Math.max(...whiteWidths) : 0;
  if (textWidth >= 44) return "sell";
  if (textWidth >= 24 && textWidth < 42 && sellBright >= buyCount) return "sell";
  if (textWidth >= 24 && buyCount > sellBright) return "buy";

  if (sellBright >= 10 && sellBright >= buyCount) return "sell";
  if (buyCount >= 10 && buyCount > sellBright) return "buy";
  return box.type;
}

/** White price text row inside a label (e.g. "SELL 1771.65"). */
function maxWhiteTextWidth(data, channels, box) {
  let best = 0;

  for (let y = box.y; y < box.y + box.height; y++) {
    let whiteMin = Infinity;
    let whiteMax = -Infinity;
    let whiteN = 0;

    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, channels, x, y);
      if (r > 205 && g > 205 && b > 205) {
        whiteN++;
        whiteMin = Math.min(whiteMin, x);
        whiteMax = Math.max(whiteMax, x);
      }
    }

    if (whiteN >= 8) {
      best = Math.max(best, whiteMax - whiteMin);
    }
  }

  return best;
}

function hasPriceText(data, channels, box) {
  return maxWhiteTextWidth(data, channels, box) >= MIN_PRICE_TEXT_W;
}

/**
 * Accept BUY/SELL text flags tied to the newest 1–2 candles (not older wide labels bleeding in).
 */
function isDashboardSignalLabel(data, channels, box) {
  if (!isCompactLabelBox(box)) return false;
  if (isChartEdgeNoise(box)) return false;
  if (isArrowMarker(data, channels, box)) return false;
  return isProbableSignalLabel(data, channels, box);
}

function isChartEdgeNoise(box) {
  if (box.y + box.height > PLOT.bottom - 4) return true;
  if (box.y < PLOT.top + 4 && box.width >= 180) return true;
  return false;
}

/**
 * Find the Future Trend Pro flag on the newest candles by scanning bright label colors.
 * Avoids bear-zone maroon shading that pollutes the generic pixel sweep.
 */
function findRightmostFlagLabel(data, channels, zone) {
  const scanLeft = Math.max(PLOT.left, zone.left - MAX_LABEL_W);
  const scanRight = Math.min(W - 1, zone.right + 12);
  const boxes = [];

  for (const type of ["buy", "sell"]) {
    const pixels = [];
    const matches =
      type === "buy"
        ? (r, g, b) => isBuyGreen(r, g, b)
        : (r, g, b) => isSellRed(r, g, b);

    for (let y = PLOT.top; y < PLOT.bottom; y++) {
      for (let x = scanLeft; x < scanRight; x++) {
        if (inStatusTable(x, y)) continue;
        const [r, g, b] = getPixel(data, channels, x, y);
        if (matches(r, g, b)) pixels.push({ x, y });
      }
    }

    if (!pixels.length) continue;

    pixels.sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    let group = [pixels[0]];
    let groupMinY = pixels[0].y;

    for (let i = 1; i < pixels.length; i++) {
      const p = pixels[i];
      if (p.y - groupMinY <= MAX_LABEL_H + 8) {
        group.push(p);
      } else {
        groups.push(group);
        group = [p];
        groupMinY = p.y;
      }
    }
    groups.push(group);

    for (const g of groups) {
      if (g.length < 24) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of g) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const box = {
        type,
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
      if (!isCompactLabelBox(box)) continue;
      if (!boxAnchoredOnLastCandles(box, zone)) continue;
      if (!isDashboardSignalLabel(data, channels, box)) continue;
      boxes.push(box);
    }
  }

  if (!boxes.length) return null;

  const priceY = findPriceLineY(data, channels);
  const cols = candleColumns(zone);

  for (let c = cols.length - 1; c >= 0; c--) {
    const col = cols[c];
    const inCol = boxes
      .filter((box) => labelInColumn(box, col))
      .map((box) => ({ ...box, type: classifyLabelBox(data, channels, box) }));

    if (!inCol.length) continue;

    if (inCol.length === 1) return inCol[0];

    const sells = inCol.filter((b) => b.type === "sell");
    const buys = inCol.filter((b) => b.type === "buy");

    if (priceY != null) {
      const scored = inCol.map((box) => {
        const cy = box.y + box.height / 2;
        const expected =
          box.type === "sell"
            ? cy < priceY - 8
            : cy > priceY - 24;
        return { box, score: (box.x + box.width) + (expected ? 200 : 0) };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored[0].box;
    }

    if (sells.length && buys.length) {
      const sell = sells.sort((a, b) => a.y - b.y)[0];
      const buy = buys.sort((a, b) => b.y - a.y)[0];
      return sell.y < buy.y ? sell : buy;
    }

    return inCol.sort((a, b) => b.x + b.width - (a.x + a.width))[0];
  }

  return null;
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

/** Bbox built from pixel sweep — already validated by size; skip sparse row scan. */
function isProbableSignalLabel(data, channels, box) {
  if (isTextSignalLabel(data, channels, box)) return true;

  if (
    box.width < MIN_TEXT_LABEL_W ||
    box.width > MAX_LABEL_W ||
    box.height < MIN_TEXT_LABEL_H ||
    box.height > MAX_LABEL_H ||
    box.width / box.height < MIN_TEXT_ASPECT
  ) {
    if (
      box.type === "sell" &&
      box.width >= MIN_TEXT_LABEL_W &&
      box.width <= MAX_LABEL_W &&
      box.height >= MIN_TEXT_LABEL_H &&
      box.height <= MAX_LABEL_H &&
      hasSellBorderAccent(data, channels, box)
    ) {
      return true;
    }
    return false;
  }

  // Wide labels with price text (e.g. "SELL 584.07") can look like arrows row-by-row.
  if (box.width >= 55 && box.width / box.height >= 1.2) {
    return true;
  }

  if (box.type === "sell" && hasSellBorderAccent(data, channels, box)) {
    return true;
  }

  return !isArrowMarker(data, channels, box);
}

/** Label must sit on one of the last 3 candle columns (newest columns use tighter padding). */
function boxAnchoredOnLastCandles(box, zone) {
  const cols = candleColumns(zone);
  return cols.some((col, index) => {
    const pad = 26 + (cols.length - 1 - index) * 8;
    return labelInColumn(box, col, pad);
  });
}

/** @deprecated alias */
function boxOverlapsLastCandles(box, zone) {
  return boxAnchoredOnLastCandles(box, zone);
}

function candleColumns(zone) {
  const cols = [];
  for (let i = 0; i < LAST_CANDLES; i++) {
    cols.push({
      index: i,
      left: zone.left + i * CANDLE_WIDTH_PX,
      right: zone.left + (i + 1) * CANDLE_WIDTH_PX,
    });
  }
  return cols;
}

function labelCenterX(box) {
  return box.x + box.width / 2;
}

function labelInColumn(box, col, pad = 32) {
  const cx = labelCenterX(box);
  return cx >= col.left - pad && cx <= col.right + pad;
}

/** Newest candle first — pick the signal on the rightmost column that has a label. */
function pickLatestSignalLabel(labels, zone, data, channels) {
  if (!labels.length) return null;

  const cols = candleColumns(zone);
  const priceY = data && channels != null ? findPriceLineY(data, channels) : null;

  const relabel = (box) => ({
    ...box,
    type: data && channels != null ? classifyLabelBox(data, channels, box) : box.type,
  });

  for (let c = cols.length - 1; c >= 0; c--) {
    const col = cols[c];
    const inCol = labels
      .filter((box) => labelInColumn(box, col))
      .map(relabel);
    if (!inCol.length) continue;

    const sells = inCol.filter((b) => b.type === "sell");
    const buys = inCol.filter((b) => b.type === "buy");

    if (priceY != null && sells.length && buys.length) {
      const sellFit = sells.filter((b) => b.y + b.height / 2 < priceY - 8);
      const buyFit = buys.filter((b) => b.y + b.height / 2 > priceY - 24);
      if (sellFit.length && !buyFit.length) return sellFit.sort((a, b) => a.y - b.y)[0];
      if (buyFit.length && !sellFit.length) return buyFit.sort((a, b) => b.y - a.y)[0];
    }

    if (sells.length && buys.length) {
      const sell = sells.sort((a, b) => a.y - b.y)[0];
      const buy = buys.sort((a, b) => b.y - a.y)[0];
      return sell.y < buy.y ? sell : buy;
    }
    if (sells.length) {
      return sells.sort((a, b) => a.y - b.y)[0];
    }
    if (buys.length) {
      return buys.sort((a, b) => b.y - a.y)[0];
    }
  }

  return null;
}

function mergeBoxes(boxes) {
  const merged = [];

  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hit = merged.find(
      (m) =>
        m.type === box.type &&
        Math.abs(m.x - box.x) < 80 &&
        boxesOverlapX(m, box, 0.35) &&
        box.y <= m.y + m.height + 28 &&
        box.y >= m.y - 28
    );

    if (hit) {
      const right = Math.max(hit.x + hit.width, box.x + box.width);
      const newY = Math.min(hit.y, box.y);
      const newH = Math.max(hit.y + hit.height, box.y + box.height) - newY;

      // Text labels and arrow markers stack vertically — don't fuse into one oversized box.
      if (newH > MAX_LABEL_H) {
        merged.push({ ...box });
        continue;
      }

      const newW = right - Math.min(hit.x, box.x);
      if (newW > MAX_LABEL_W) {
        merged.push({ ...box });
        continue;
      }

      hit.y = newY;
      hit.height = newH;
      hit.x = Math.min(hit.x, box.x);
      hit.width = newW;
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

function boxesOverlapX(a, b, minRatio = 0.3) {
  const overlapLeft = Math.max(a.x, b.x);
  const overlapRight = Math.min(a.x + a.width, b.x + b.width);
  const overlap = Math.max(0, overlapRight - overlapLeft);
  const minWidth = Math.min(a.width, b.width);
  return minWidth > 0 && overlap / minWidth >= minRatio;
}

/** Merge fragmented letter runs on the same row (anti-aliased "SELL 584.07" text). */
function mergeHorizontalRowRuns(boxes) {
  const byKey = new Map();

  for (const box of boxes) {
    const key = `${box.type}:${box.y}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(box);
  }

  const merged = [];
  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.x - b.x);
    let current = null;

    for (const box of sorted) {
      if (!current) {
        current = { ...box };
        continue;
      }

      const gap = box.x - (current.x + current.width);
      if (gap <= 16) {
        const right = Math.max(current.x + current.width, box.x + box.width);
        current.x = Math.min(current.x, box.x);
        current.width = right - current.x;
      } else {
        merged.push(current);
        current = { ...box };
      }
    }

    if (current) merged.push(current);
  }

  return merged;
}

/** Build bounding boxes from same-color pixels (handles gapped "SELL 584.07" text). */
function collectTypeBoundingBoxes(data, channels, scanLeft, scanRight) {
  const pixelsByType = { buy: [], sell: [] };

  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    for (let x = scanLeft; x < scanRight; x++) {
      if (inStatusTable(x, y)) continue;
      const [r, g, b] = getPixel(data, channels, x, y);
      const type = labelColor(r, g, b);
      if (type) pixelsByType[type].push({ x, y });
    }
  }

  const boxes = [];

  for (const type of ["buy", "sell"]) {
    const pixels = pixelsByType[type];
    if (!pixels.length) continue;

    pixels.sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    let group = [pixels[0]];
    let groupMinY = pixels[0].y;

    for (let i = 1; i < pixels.length; i++) {
      const p = pixels[i];
      if (p.y - groupMinY <= 52) {
        group.push(p);
      } else {
        groups.push(group);
        group = [p];
        groupMinY = p.y;
      }
    }
    groups.push(group);

    for (const g of groups) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const p of g) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }

      if (g.length >= 20) {
        boxes.push({
          type,
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        });
      }
    }
  }

  return boxes;
}

/** BUY must sit below candles; SELL above — real text label on newest candles. */
function isValidLastCandleSignal(signalType, position, box, zone, data, channels) {
  if (!box || !boxAnchoredOnLastCandles(box, zone)) return false;
  if (!isProbableSignalLabel(data, channels, box)) return false;
  if (isChartEdgeNoise(box)) return false;
  if (signalType === "buy" && position === "bottom") return true;
  if (signalType === "sell" && position === "top") return true;
  return false;
}

async function analyzeChartSignal(imagePath) {
  const zone = lastCandlesZone();
  const scanLeft = Math.max(PLOT.left, zone.left - MAX_LABEL_W);
  const scanRight = Math.min(W - 1, zone.right + 12);

  try {
    await fs.access(imagePath);
  } catch {
    return emptySignalResult(zone, scanLeft, scanRight);
  }

  const { data, channels } = await loadChartPixels(imagePath);

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
    for (let x = scanLeft; x < scanRight; x++) {
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

  const labels = mergeBoxes([
    ...mergeHorizontalRowRuns(rowBoxes),
    ...collectTypeBoundingBoxes(data, channels, scanLeft, scanRight),
  ]).filter(
    (b) =>
      !boxInStatusTable(b) &&
      isDashboardSignalLabel(data, channels, b) &&
      boxAnchoredOnLastCandles(b, zone)
  );

  const flagLabel = findRightmostFlagLabel(data, channels, zone);
  const latest =
    flagLabel || pickLatestSignalLabel(labels, zone, data, channels);

  if (!latest || !boxAnchoredOnLastCandles(latest, zone)) {
    return emptySignalResult(zone, scanLeft, scanRight);
  }

  const signalType = classifyLabelBox(data, channels, latest);
  if (signalType !== "buy" && signalType !== "sell") {
    return emptySignalResult(zone, scanLeft, scanRight);
  }

  // Future Trend Pro draws BUY under candles and SELL above them.
  let position = signalType === "buy" ? "bottom" : "top";

  if (candleYs.length > 0) {
    const candleTop = Math.min(...candleYs);
    const candleBottom = Math.max(...candleYs);
    const candleMid = (candleTop + candleBottom) / 2;
    const labelCenterY = latest.y + latest.height / 2;
    const geometric = labelCenterY >= candleMid ? "bottom" : "top";

    // Trust geometry only when it matches the indicator convention.
    if (
      (signalType === "buy" && geometric === "bottom") ||
      (signalType === "sell" && geometric === "top")
    ) {
      position = geometric;
    }
  }

  const markers = buildScanMarkers(zone, scanLeft, scanRight, latest, false);

  if (!isValidLastCandleSignal(signalType, position, latest, zone, data, channels)) {
    return {
      signal: "none",
      position: null,
      highlight: null,
      markers,
    };
  }

  markers.labelBox.accepted = true;

  return {
    signal: signalType,
    position,
    highlight: signalType,
    markers,
  };
}

async function analyzeCoinSignal(coinId) {
  const imagePath = path.join(CURRENT_DIR, `${coinId}.png`);
  const result = await analyzeChartSignal(imagePath);
  return { coinId, ...result, analyzedAt: new Date().toISOString() };
}

/**
 * Prefer live chart detection from the screenshot; keep capture-time isNewSignal from meta.
 */
async function resolveSignalFromImage(imagePath, storedSnap = null) {
  let detected = { signal: "none", position: null };
  try {
    detected = await analyzeChartSignal(imagePath);
  } catch {
    detected = { signal: "none", position: null };
  }

  if (detected.signal === "buy" || detected.signal === "sell") {
    return {
      signal: detected.signal,
      position: detected.position,
      highlight: detected.highlight,
      markers: detected.markers || null,
      isNewSignal: Boolean(storedSnap?.isNewSignal),
      analyzedAt: storedSnap?.analyzedAt || null,
    };
  }

  if (
    storedSnap?.isNewSignal &&
    (storedSnap.signal === "buy" || storedSnap.signal === "sell")
  ) {
    return {
      signal: "none",
      position: null,
      highlight: null,
      markers: detected.markers || null,
      isNewSignal: false,
      analyzedAt: storedSnap?.analyzedAt || null,
    };
  }

  return {
    signal: "none",
    position: null,
    isNewSignal: false,
    analyzedAt: storedSnap?.analyzedAt || null,
    markers: detected.markers || null,
  };
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
  analyzeChartSignals24h,
  analyzeCoinSignal,
  analyzeCoins,
  resolveSignalFromImage,
  findAllChartTextLabels,
  dedupeChartLabels,
  filterLabelsIn24h,
  isHistoricalTextLabel,
  labelXToTime,
  window24hLeftX,
  lastCandlesZone,
  edgeZone,
  STATUS_TABLE,
  LAST_CANDLES,
  HOURS_24H,
  VISIBLE_HOURS_15M,
  CHART_WIDTH: W,
  CHART_HEIGHT: H,
  PLOT,
  CURRENT_DIR,
};
