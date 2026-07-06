const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const DEFAULT_SETTINGS = {
  autoRefreshMinutes: 5,
  columnsPerRow: 3,
  autoRefreshEnabled: true,
  chartLayoutId: "",
  chartInterval: "15",
  alertThresholdPercent: 3,
  historyPerPage: 10,
  screenshotWaitSeconds: 5,
  chartLoadMaxRetries: 6,
  autoTradeEnabled: false,
  binanceApiKey: "",
  binanceApiSecret: "",
  binanceTestnet: false,
  tradeAmountUsdt: 2,
  tradeLeverage: 10,
  tradeMarginType: "ISOLATED",
  tradeMode: "long_only",
  tradeTpPercent: 30,
  tradeSlPercent: 30,
  autoTradeRequireGuidelines: true,
};

const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 6;
const MIN_HISTORY_PER_PAGE = 5;
const MAX_HISTORY_PER_PAGE = 50;
const MIN_SCREENSHOT_WAIT_SECONDS = 0;
const MAX_SCREENSHOT_WAIT_SECONDS = 60;
const MIN_CHART_LOAD_RETRIES = 1;
const MAX_CHART_LOAD_RETRIES = 12;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function loadSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    await saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeInterval(value) {
  const raw = String(value || DEFAULT_SETTINGS.chartInterval).trim();
  if (/^\d+$/.test(raw)) return raw;
  return raw.toUpperCase();
}

function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const margin = String(merged.tradeMarginType || "ISOLATED").toUpperCase();
  const mode = String(merged.tradeMode || "long_only").toLowerCase();

  return {
    autoRefreshMinutes: clamp(
      Number(merged.autoRefreshMinutes) || DEFAULT_SETTINGS.autoRefreshMinutes,
      MIN_REFRESH_MINUTES,
      MAX_REFRESH_MINUTES
    ),
    columnsPerRow: clamp(
      Number(merged.columnsPerRow) || DEFAULT_SETTINGS.columnsPerRow,
      MIN_COLUMNS,
      MAX_COLUMNS
    ),
    autoRefreshEnabled:
      typeof merged.autoRefreshEnabled === "boolean"
        ? merged.autoRefreshEnabled
        : DEFAULT_SETTINGS.autoRefreshEnabled,
    chartLayoutId:
      typeof merged.chartLayoutId === "string"
        ? merged.chartLayoutId.trim()
        : DEFAULT_SETTINGS.chartLayoutId,
    chartInterval: normalizeInterval(merged.chartInterval),
    alertThresholdPercent: clamp(
      Number(merged.alertThresholdPercent) || DEFAULT_SETTINGS.alertThresholdPercent,
      0.5,
      50
    ),
    historyPerPage: clamp(
      Number(merged.historyPerPage) || DEFAULT_SETTINGS.historyPerPage,
      MIN_HISTORY_PER_PAGE,
      MAX_HISTORY_PER_PAGE
    ),
    screenshotWaitSeconds: clamp(
      Number.isFinite(Number(merged.screenshotWaitSeconds))
        ? Number(merged.screenshotWaitSeconds)
        : DEFAULT_SETTINGS.screenshotWaitSeconds,
      MIN_SCREENSHOT_WAIT_SECONDS,
      MAX_SCREENSHOT_WAIT_SECONDS
    ),
    chartLoadMaxRetries: clamp(
      Number.isFinite(Number(merged.chartLoadMaxRetries))
        ? Number(merged.chartLoadMaxRetries)
        : DEFAULT_SETTINGS.chartLoadMaxRetries,
      MIN_CHART_LOAD_RETRIES,
      MAX_CHART_LOAD_RETRIES
    ),
    autoTradeEnabled: Boolean(merged.autoTradeEnabled),
    binanceApiKey:
      typeof merged.binanceApiKey === "string" ? merged.binanceApiKey.trim() : "",
    binanceApiSecret:
      typeof merged.binanceApiSecret === "string" ? merged.binanceApiSecret.trim() : "",
    binanceTestnet:
      typeof merged.binanceTestnet === "boolean"
        ? merged.binanceTestnet
        : DEFAULT_SETTINGS.binanceTestnet,
    tradeAmountUsdt: clamp(
      Number(merged.tradeAmountUsdt) || DEFAULT_SETTINGS.tradeAmountUsdt,
      1,
      100000
    ),
    tradeLeverage: clamp(
      Number(merged.tradeLeverage) || DEFAULT_SETTINGS.tradeLeverage,
      1,
      125
    ),
    tradeMarginType: margin === "CROSSED" ? "CROSSED" : "ISOLATED",
    tradeMode: mode === "reversal" ? "reversal" : "long_only",
    tradeTpPercent: clamp(
      Number(merged.tradeTpPercent) || DEFAULT_SETTINGS.tradeTpPercent,
      0.5,
      90
    ),
    tradeSlPercent: clamp(
      Number(merged.tradeSlPercent) || DEFAULT_SETTINGS.tradeSlPercent,
      0.5,
      90
    ),
    autoTradeRequireGuidelines:
      typeof merged.autoTradeRequireGuidelines === "boolean"
        ? merged.autoTradeRequireGuidelines
        : DEFAULT_SETTINGS.autoTradeRequireGuidelines,
  };
}

async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

async function getSettings() {
  return loadSettings();
}

async function updateSettings(partial) {
  const current = await loadSettings();
  const patch = { ...partial };

  // Keep existing secrets when form sends blank placeholders.
  if (patch.binanceApiKey === "" || patch.binanceApiKey == null) {
    delete patch.binanceApiKey;
  }
  if (patch.binanceApiSecret === "" || patch.binanceApiSecret == null) {
    delete patch.binanceApiSecret;
  }

  return saveSettings({ ...current, ...patch });
}

function autoRefreshMs(settings) {
  return settings.autoRefreshMinutes * 60 * 1000;
}

/** Safe settings for the browser — never includes full API secret. */
function publicSettings(settings) {
  return {
    autoRefreshMinutes: settings.autoRefreshMinutes,
    columnsPerRow: settings.columnsPerRow,
    autoRefreshEnabled: settings.autoRefreshEnabled,
    autoRefreshMs: autoRefreshMs(settings),
    chartLayoutId: settings.chartLayoutId || "",
    chartInterval: settings.chartInterval || "15",
    alertThresholdPercent: settings.alertThresholdPercent ?? 3,
    historyPerPage: settings.historyPerPage ?? 10,
    screenshotWaitSeconds: settings.screenshotWaitSeconds ?? 5,
    chartLoadMaxRetries: settings.chartLoadMaxRetries ?? 6,
    autoTradeEnabled: Boolean(settings.autoTradeEnabled),
    binanceApiKeyConfigured: Boolean(settings.binanceApiKey),
    binanceApiSecretConfigured: Boolean(settings.binanceApiSecret),
    binanceApiKeyMasked: maskSecret(settings.binanceApiKey),
    binanceTestnet: Boolean(settings.binanceTestnet),
    tradeAmountUsdt: settings.tradeAmountUsdt,
    tradeLeverage: settings.tradeLeverage,
    tradeMarginType: settings.tradeMarginType,
    tradeMode: settings.tradeMode,
    tradeTpPercent: settings.tradeTpPercent,
    tradeSlPercent: settings.tradeSlPercent,
    autoTradeRequireGuidelines: Boolean(settings.autoTradeRequireGuidelines),
  };
}

module.exports = {
  getSettings,
  updateSettings,
  autoRefreshMs,
  publicSettings,
  MIN_REFRESH_MINUTES,
  MAX_REFRESH_MINUTES,
  MIN_COLUMNS,
  MAX_COLUMNS,
};
