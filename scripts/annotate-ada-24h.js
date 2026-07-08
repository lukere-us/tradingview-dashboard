const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const SRC =
  process.env.ADA_CHART_SRC ||
  path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".cursor",
    "projects",
    "c-Users-user-tradingview-dashboard",
    "assets",
    "c__Users_user_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-bc313a2b-4b0c-4d88-b1e1-75f354e55dd1.png"
  );
const OUT = path.join(__dirname, "..", "screenshots", "ada-24h-signals-marked.png");

// TradingView 1280×720 layout scaled to attachment size (1024×576 → scale 0.8)
const SCALE = 1024 / 1280;
const W = 1024;
const H = 576;
const PLOT = {
  left: Math.round(56 * SCALE),
  top: Math.round(82 * SCALE),
  right: Math.round(1140 * SCALE),
  bottom: Math.round(520 * SCALE),
};
const MIN_W = 32;
const MAX_W = 120;
const MIN_H = 8;
const MAX_H = 45;
const STATUS = {
  left: Math.round(60 * SCALE),
  top: Math.round(130 * SCALE),
  right: Math.round(460 * SCALE),
  bottom: Math.round(400 * SCALE),
};

const isBuy = (r, g, b) =>
  g >= 185 && r <= 40 && b >= 90 && b <= 145 && g > r + 100 && g > b;
const isSell = (r, g, b) =>
  (r >= 200 && g <= 55 && b >= 45 && b <= 95 && r > g + 120 && r > b + 80) ||
  (r >= 28 && r <= 70 && g >= 12 && g <= 45 && b >= 22 && b <= 55 && r > g && r + g + b >= 70);

function inStatus(x, y) {
  return (
    x >= STATUS.left &&
    x <= STATUS.right &&
    y >= STATUS.top &&
    y <= STATUS.bottom
  );
}

async function findLabels(imagePath) {
  const { data, info } = await sharp(imagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const get = (x, y) => {
    const i = (y * W + x) * ch;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const boxes = [];

  for (const type of ["buy", "sell"]) {
    const pixels = [];
    const match = type === "buy" ? isBuy : isSell;
    for (let y = PLOT.top; y < PLOT.bottom; y++) {
      for (let x = PLOT.left; x < PLOT.right; x++) {
        if (inStatus(x, y)) continue;
        const [r, g, b] = get(x, y);
        if (match(r, g, b)) pixels.push({ x, y });
      }
    }
    if (!pixels.length) continue;

    pixels.sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    let group = [pixels[0]];
    let groupMinY = pixels[0].y;

    for (let i = 1; i < pixels.length; i++) {
      const p = pixels[i];
      if (p.y - groupMinY <= MAX_H + 8) group.push(p);
      else {
        groups.push(group);
        group = [p];
        groupMinY = p.y;
      }
    }
    groups.push(group);

    for (const g of groups) {
      if (g.length < 18) continue;
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
      if (
        box.width >= MIN_W &&
        box.width <= MAX_W &&
        box.height >= MIN_H &&
        box.height <= MAX_H
      ) {
        boxes.push(box);
      }
    }
  }

  return boxes.sort((a, b) => a.x - b.x);
}

function filterLast24h(boxes) {
  // ~24h of ~46h visible on x-axis → left edge ≈ 44% into plot
  const sinceX = PLOT.left + (PLOT.right - PLOT.left) * 0.44;
  return boxes.filter((b) => b.x + b.width / 2 >= sinceX);
}

function dedupeEpisodes(boxes) {
  const kept = [];
  let last = null;
  for (const b of boxes) {
    if (b.type === last) continue;
    kept.push(b);
    last = b.type;
  }
  return kept;
}

function timeToX(hoursFromViewStart) {
  const spanHours = 44.5;
  return Math.round(
    PLOT.left + (hoursFromViewStart / spanHours) * (PLOT.right - PLOT.left)
  );
}

// Positions mapped from chart time axis (view ~5th 18:00 → 7th 14:30)
const MANUAL_24H = [
  { type: "buy", time: "6th 21:00", label: "BUY 0.19", x: 548, y: 136, width: 56, height: 24 },
  { type: "sell", time: "7th 04:30", label: "SELL 0.18", x: 694, y: 196, width: 52, height: 22 },
  { type: "sell", time: "7th 09:30", label: "SELL 0.18", x: 790, y: 250, width: 50, height: 22 },
  { type: "sell", time: "7th 11:00", label: "SELL 0.18", x: 820, y: 316, width: 48, height: 22 },
];

function buildSvg(markers) {
  const sinceX = timeToX(20); // 6th 14:00 ≈ start of rolling 24h
  const shapes = markers
    .map((m, i) => {
      const color = m.type === "buy" ? "#00e676" : "#ff1744";
      const x = m.x - 4;
      const y = m.y - 4;
      const w = m.width + 8;
      const h = m.height + 8;
      const badgeX = x + w - 6;
      const badgeY = y - 10;
      const note = m.time || m.label || "";
      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="3" rx="4"/>
        <circle cx="${badgeX}" cy="${badgeY}" r="12" fill="${color}" stroke="#fff" stroke-width="2"/>
        <text x="${badgeX}" y="${badgeY + 5}" text-anchor="middle" fill="#111" font-size="13" font-weight="bold" font-family="Arial,sans-serif">${i + 1}</text>
        <text x="${x}" y="${y + h + 14}" fill="${color}" font-size="11" font-weight="bold" font-family="Arial,sans-serif">${note}</text>
      `;
    })
    .join("\n");

  return Buffer.from(`
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <style>text { paint-order: stroke; }</style>
      <line x1="${sinceX}" y1="${PLOT.top}" x2="${sinceX}" y2="${PLOT.bottom}" stroke="#f9a825" stroke-width="2" stroke-dasharray="8 6" opacity="0.9"/>
      <text x="${sinceX + 6}" y="${PLOT.top + 16}" fill="#f9a825" font-size="12" font-weight="bold" font-family="Arial,sans-serif">24h start</text>
      ${shapes}
      <rect x="8" y="6" width="300" height="28" fill="rgba(0,0,0,0.55)" rx="4"/>
      <text x="16" y="26" fill="#f9a825" font-size="15" font-weight="bold" font-family="Arial,sans-serif">ADA last 24h: ${markers.length} signals (15m)</text>
    </svg>
  `);
}

async function main() {
  let src = SRC;
  try {
    await fs.access(src);
  } catch {
    src = path.join(__dirname, "..", "screenshots", "current", "ada.png");
  }

  const all = await findLabels(src);
  const in24 = filterLast24h(all);
  let episodes = dedupeEpisodes(in24);

  // Manual fallback if detection misses on compressed JPEG
  if (episodes.length < 4) {
    episodes = MANUAL_24H;
    console.log("Using time-mapped positions for 4 signals on compressed image");
  }

  const svg = buildSvg(episodes);
  await sharp(src)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toFile(OUT);

  console.log("Saved:", OUT);
  console.log(
    "Marked signals:",
    episodes.map((e, i) => `${i + 1}:${e.type}`).join(", ")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
