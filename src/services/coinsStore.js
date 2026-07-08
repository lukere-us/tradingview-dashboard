const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const COINS_FILE = path.join(DATA_DIR, "coins.json");

const GROUPS = [
  { id: "majors", label: "Majors" },
  { id: "alts", label: "Alts" },
  { id: "memes", label: "Memes" },
];

const DEFAULT_GROUP = "majors";

const DEFAULT_GROUP_BY_ID = {
  btc: "majors",
  eth: "majors",
  bnb: "majors",
  xrp: "majors",
  sol: "majors",
  ada: "alts",
  avax: "alts",
  link: "alts",
  trx: "alts",
  doge: "memes",
};

const DEFAULT_PINNED = new Set(["btc", "eth", "sol"]);

const DEFAULT_COINS = [
  { id: "btc", name: "Bitcoin", symbol: "BINANCE:BTCUSDT" },
  { id: "eth", name: "Ethereum", symbol: "BINANCE:ETHUSDT" },
  { id: "bnb", name: "BNB", symbol: "BINANCE:BNBUSDT" },
  { id: "xrp", name: "XRP", symbol: "BINANCE:XRPUSDT" },
  { id: "sol", name: "Solana", symbol: "BINANCE:SOLUSDT" },
  { id: "ada", name: "Cardano", symbol: "BINANCE:ADAUSDT" },
  { id: "doge", name: "Dogecoin", symbol: "BINANCE:DOGEUSDT" },
  { id: "trx", name: "TRON", symbol: "BINANCE:TRXUSDT" },
  { id: "avax", name: "Avalanche", symbol: "BINANCE:AVAXUSDT" },
  { id: "link", name: "Chainlink", symbol: "BINANCE:LINKUSDT" },
].map((coin) => normalizeCoin(coin));

function slugFromSymbol(symbol) {
  return symbol
    .replace(/^[^:]+:/i, "")
    .replace(/USDT$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeGroup(group) {
  const id = String(group || DEFAULT_GROUP).toLowerCase();
  return GROUPS.some((g) => g.id === id) ? id : DEFAULT_GROUP;
}

function normalizeCoin(coin) {
  return {
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    group: normalizeGroup(coin.group || DEFAULT_GROUP_BY_ID[coin.id]),
    pinned: Boolean(coin.pinned ?? DEFAULT_PINNED.has(coin.id)),
    enabled: coin.enabled !== false,
  };
}

function sortCoins(coins) {
  return coins
    .map((coin, index) => ({ coin, index }))
    .sort((a, b) => {
      if (a.coin.enabled !== b.coin.enabled) {
        return Number(b.coin.enabled) - Number(a.coin.enabled);
      }
      if (a.coin.pinned !== b.coin.pinned) {
        return Number(b.coin.pinned) - Number(a.coin.pinned);
      }
      return a.index - b.index;
    })
    .map(({ coin }) => coin);
}

/** Keep coin-list order (pinned first, then list sequence). */
function orderCoinIds(ids, coins) {
  const idSet = new Set(ids);
  const ordered = coins.map((c) => c.id).filter((id) => idSet.has(id));
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

async function loadCoins() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(COINS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = parsed.map((c) => normalizeCoin(c));
    await saveCoins(normalized);
    return normalized;
  } catch {
    await saveCoins(DEFAULT_COINS);
    return [...DEFAULT_COINS];
  }
}

async function saveCoins(coins) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(COINS_FILE, JSON.stringify(coins, null, 2));
}

async function getCoins({ group = null } = {}) {
  const coins = sortCoins(await loadCoins());
  if (!group || group === "all") return coins;
  return coins.filter((c) => c.group === group);
}

async function getActiveCoins(options = {}) {
  const coins = await getCoins(options);
  return coins.filter((c) => c.enabled);
}

async function addCoin({ name, symbol, id, group }) {
  const coins = await loadCoins();
  const trimmedName = name?.trim();
  const trimmedSymbol = symbol?.trim().toUpperCase();

  if (!trimmedName || !trimmedSymbol) {
    throw new Error("Name and symbol are required");
  }

  const coinId = (id?.trim() || slugFromSymbol(trimmedSymbol)).toLowerCase();
  if (!coinId) {
    throw new Error("Could not generate a valid coin id");
  }

  if (coins.some((c) => c.id === coinId)) {
    throw new Error(`Coin id "${coinId}" already exists`);
  }

  if (coins.some((c) => c.symbol === trimmedSymbol)) {
    throw new Error(`Symbol "${trimmedSymbol}" is already in the list`);
  }

  const coin = normalizeCoin({
    id: coinId,
    name: trimmedName,
    symbol: trimmedSymbol,
    group: group || DEFAULT_GROUP,
    pinned: false,
    enabled: true,
  });
  coins.push(coin);
  await saveCoins(coins);
  return coin;
}

async function updateCoin(coinId, patch) {
  const coins = await loadCoins();
  const index = coins.findIndex((c) => c.id === coinId);
  if (index === -1) {
    throw new Error(`Coin "${coinId}" not found`);
  }

  const current = coins[index];
  const updated = normalizeCoin({
    ...current,
    ...patch,
    id: current.id,
    name: current.name,
    symbol: current.symbol,
  });

  if (patch.group !== undefined) {
    updated.group = normalizeGroup(patch.group);
  }
  if (patch.pinned !== undefined) {
    updated.pinned = Boolean(patch.pinned);
  }
  if (patch.enabled !== undefined) {
    updated.enabled = Boolean(patch.enabled);
  }

  coins[index] = updated;
  await saveCoins(coins);
  return updated;
}

async function removeCoin(coinId) {
  const coins = await loadCoins();
  const index = coins.findIndex((c) => c.id === coinId);
  if (index === -1) {
    throw new Error(`Coin "${coinId}" not found`);
  }
  const [removed] = coins.splice(index, 1);
  await saveCoins(coins);
  return removed;
}

module.exports = {
  GROUPS,
  getCoins,
  getActiveCoins,
  addCoin,
  updateCoin,
  removeCoin,
  sortCoins,
  orderCoinIds,
  normalizeCoin,
  slugFromSymbol,
};
