const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");

const W = 1280;
const PLOT = { left: 56, top: 82, right: 1140, bottom: 500 };
const EDGE_WIDTH = 72;
const MIN_LABEL_W = 18;
const MIN_LABEL_H = 8;
const MAX_LABEL_H = 32;

const CURRENT_DIR = path.join(__dirname, "..", "..", "screenshots", "current");

function edgeZone() {
  return {
    left: PLOT.right - EDGE_WIDTH,
    right: PLOT.right,
  };
}

function isBuyGreen(r, g, b) {
  return g >= 200 && r <= 25 && b >= 100 && b <= 130;
}

function isSellRed(r, g, b) {
  return r >= 215 && g <= 45 && b >= 60 && b <= 85;
}

function isChartBackground(r, g, b) {
  return r < 48 && g < 52 && b < 68;
}

function getPixel(data, x, y) {
  const i = (y * W + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

function labelColor(r, g, b) {
  if (isBuyGreen(r, g, b)) return "buy";
  if (isSellRed(r, g, b)) return "sell";
  return null;
}

function boxInEdgeZone(box, edge) {
  const centerX = box.x + box.width / 2;
  const rightEdge = box.x + box.width;
  return centerX >= edge.left && rightEdge >= edge.left + 8 && box.x < edge.right;
}

function hasLabelFill(data, box) {
  let match = 0;
  let total = 0;

  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const [r, g, b] = getPixel(data, x, y);
      total++;
      if (labelColor(r, g, b) === box.type) match++;
    }
  }

  return total > 0 && match / total >= 0.5;
}

function mergeBoxes(boxes) {
  const merged = [];

  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const hit = merged.find(
      (m) =>
        m.type === box.type &&
        Math.abs(m.x - box.x) < 35 &&
        box.y <= m.y + m.height + 4 &&
        box.y >= m.y - 4
    );

    if (hit) {
      hit.y = Math.min(hit.y, box.y);
      hit.height = Math.max(hit.y + hit.height, box.y + box.height) - hit.y;
      hit.width = Math.max(hit.width, box.x + box.width - hit.x);
      hit.x = Math.min(hit.x, box.x);
    } else {
      merged.push({ ...box });
    }
  }

  return merged.filter(
    (b) =>
      b.width >= MIN_LABEL_W &&
      b.height >= MIN_LABEL_H &&
      b.height <= MAX_LABEL_H &&
      b.width / b.height >= 1.2
  );
}

async function analyzeChartSignal(imagePath) {
  try {
    await fs.access(imagePath);
  } catch {
    return { signal: "none", position: null, highlight: null };
  }

  const { data } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const edge = edgeZone();
  const candleYs = [];

  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    for (let x = edge.left; x < edge.right; x++) {
      const [r, g, b] = getPixel(data, x, y);
      if (labelColor(r, g, b) || isChartBackground(r, g, b)) continue;
      if (r + g + b < 70) continue;
      candleYs.push(y);
    }
  }

  const rowBoxes = [];
  for (let y = PLOT.top; y < PLOT.bottom; y++) {
    let runStart = null;
    let runType = null;

    for (let x = edge.left; x < edge.right; x++) {
      const [r, g, b] = getPixel(data, x, y);
      const type = labelColor(r, g, b);

      if (type === runType && type) continue;

      if (runType && runStart != null) {
        const width = x - runStart;
        if (width >= 8) {
          rowBoxes.push({ type: runType, x: runStart, y, width, height: 1 });
        }
      }

      runStart = type ? x : null;
      runType = type;
    }
  }

  const labels = mergeBoxes(rowBoxes).filter(
    (b) => boxInEdgeZone(b, edge) && hasLabelFill(data, b)
  );

  if (labels.length === 0) {
    return { signal: "none", position: null, highlight: null };
  }

  const latest = labels.reduce((best, box) =>
    box.x + box.width > best.x + best.width ? box : best
  );

  if (candleYs.length === 0) {
    return { signal: latest.type, position: null, highlight: null };
  }

  const candleTop = Math.min(...candleYs);
  const candleBottom = Math.max(...candleYs);
  const candleMid = (candleTop + candleBottom) / 2;
  const labelCenterY = latest.y + latest.height / 2;
  const position = labelCenterY >= candleMid ? "bottom" : "top";

  let highlight = null;
  if (latest.type === "buy" && position === "bottom") highlight = "buy";
  else if (latest.type === "sell" && position === "top") highlight = "sell";
  else highlight = "mixed";

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
  edgeZone,
};
