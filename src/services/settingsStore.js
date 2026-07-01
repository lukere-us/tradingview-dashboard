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
};

const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;
const MIN_HISTORY_PER_PAGE = 5;
const MAX_HISTORY_PER_PAGE = 50;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  return saveSettings({ ...current, ...partial });
}

function autoRefreshMs(settings) {
  return settings.autoRefreshMinutes * 60 * 1000;
}

module.exports = {
  getSettings,
  updateSettings,
  autoRefreshMs,
  MIN_REFRESH_MINUTES,
  MAX_REFRESH_MINUTES,
  MIN_COLUMNS,
  MAX_COLUMNS,
};
