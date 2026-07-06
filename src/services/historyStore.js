const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const SCREENSHOTS_DIR = path.join(__dirname, "..", "..", "screenshots");
const CURRENT_DIR = path.join(SCREENSHOTS_DIR, "current");
const HISTORY_DIR = path.join(SCREENSHOTS_DIR, "history");

async function loadHistoryIndex() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveHistoryIndex(entries) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2));
}

function makeSetId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function archiveScreenshotSet({ trigger, coins, results, prices = null }) {
  const setId = makeSetId();
  const setDir = path.join(HISTORY_DIR, setId);
  await fs.mkdir(setDir, { recursive: true });

  const archived = [];
  for (const coin of coins) {
    const src = path.join(CURRENT_DIR, `${coin.id}.png`);
    const dest = path.join(setDir, `${coin.id}.png`);
    try {
      await fs.copyFile(src, dest);
      archived.push(coin.id);
    } catch {
      // Screenshot may be missing if capture failed for this coin.
    }
  }

  const entry = {
    id: setId,
    at: new Date().toISOString(),
    trigger,
    coinCount: coins.length,
    successCount: results.filter((r) => r.status === "ok").length,
    coins: coins.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol })),
    results,
    images: archived,
    prices: prices || null,
  };

  const metaPath = path.join(setDir, "meta.json");
  await fs.writeFile(metaPath, JSON.stringify(entry, null, 2));

  const index = await loadHistoryIndex();
  index.unshift(entry);
  await saveHistoryIndex(index);

  return entry;
}

async function listSets() {
  return loadHistoryIndex();
}

async function getSet(setId) {
  const index = await loadHistoryIndex();
  const entry = index.find((s) => s.id === setId);
  if (!entry) {
    throw new Error(`Screenshot set "${setId}" not found`);
  }
  return entry;
}

async function patchSetMeta(setId, patch) {
  const metaPath = path.join(HISTORY_DIR, setId, "meta.json");
  let meta;
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    meta = JSON.parse(raw);
  } catch {
    throw new Error(`Screenshot set meta "${setId}" not found`);
  }

  const next = { ...meta, ...patch };
  await fs.writeFile(metaPath, JSON.stringify(next, null, 2));

  const index = await loadHistoryIndex();
  const idx = index.findIndex((s) => s.id === setId);
  if (idx >= 0) {
    index[idx] = { ...index[idx], ...patch };
    await saveHistoryIndex(index);
  }

  return next;
}

module.exports = {
  CURRENT_DIR,
  HISTORY_DIR,
  SCREENSHOTS_DIR,
  archiveScreenshotSet,
  listSets,
  getSet,
  patchSetMeta,
};
