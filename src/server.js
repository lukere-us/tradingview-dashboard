require("./puppeteer-env");
const express = require("express");
const path = require("path");
const { captureAllCoins } = require("./services/screenshotter");
const { getCoins, getActiveCoins, addCoin, updateCoin, removeCoin, GROUPS } = require("./services/coinsStore");
const {
  archiveScreenshotSet,
  listSets,
  getSet,
  SCREENSHOTS_DIR,
} = require("./services/historyStore");
const {
  getSettings,
  updateSettings,
  autoRefreshMs,
  publicSettings,
} = require("./services/settingsStore");
const { getPnLReport } = require("./services/pnlReport");
const {
  testBinanceConnection,
  listTrades,
  getTradeById,
  rerunTradeById,
} = require("./services/binanceTrade");
const {
  getSessionStatus,
  openLoginBrowser,
  closeLoginBrowser,
} = require("./services/tradingviewSession");
const { getAlerts, refreshPrices, loadPriceStore } = require("./services/priceAlerts");
const { runLocalTradeAnalysis } = require("./services/localTradeAnalyze");
const { getSignals, updateSignalsForCoins } = require("./services/signalsStore");
const { getSignalStats, getSignalBarDetails } = require("./services/signalHistoryStore");

function emptySignalAnalysis() {
  return {
    running: false,
    total: 0,
    queue: [],
    current: null,
    completed: [],
    results: {},
  };
}

async function runSignalAnalysis(coinIds, historySetId = null) {
  if (coinIds.length === 0 || captureState.signalAnalysis?.running) return;

  captureState.signalAnalysis = {
    running: true,
    total: coinIds.length,
    queue: coinIds,
    current: null,
    completed: [],
    results: {},
  };

  try {
    await updateSignalsForCoins(coinIds, (event) => {
      if (event.phase === "start") {
        captureState.signalAnalysis.current = event.coinId;
      } else if (event.phase === "done") {
        captureState.signalAnalysis.completed.push(event.coinId);
        captureState.signalAnalysis.results[event.coinId] = event.result;
      }
    }, { historySetId });
  } finally {
    captureState.signalAnalysis.running = false;
    captureState.signalAnalysis.current = null;
  }
}

const app = express();
const PORT = process.env.PORT || 3002;

let settings = {
  autoRefreshMinutes: 5,
  columnsPerRow: 3,
  autoRefreshEnabled: true,
};
let autoRefreshTimer = null;
let nextCaptureAt = null;

function computeNextCaptureDelayMs() {
  if (!settings.autoRefreshEnabled) return null;
  const interval = autoRefreshMs(settings);
  const base = captureState.lastRun?.at
    ? new Date(captureState.lastRun.at).getTime()
    : Date.now();
  return Math.max(0, base + interval - Date.now());
}

function scheduleNextAutoCapture() {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!settings.autoRefreshEnabled) {
    nextCaptureAt = null;
    return;
  }

  const delay = computeNextCaptureDelayMs();
  nextCaptureAt = new Date(Date.now() + delay).toISOString();

  autoRefreshTimer = setTimeout(() => {
    triggerAutoCapture();
  }, delay);
}

function triggerAutoCapture() {
  if (!settings.autoRefreshEnabled) {
    nextCaptureAt = null;
    return;
  }

  if (captureState.running || captureState.signalAnalysis?.running) {
    autoRefreshTimer = setTimeout(triggerAutoCapture, 2000);
    nextCaptureAt = new Date(Date.now() + 2000).toISOString();
    return;
  }

  console.log("Auto-refresh: capturing screenshots...");
  runCapture("auto").catch((err) => {
    console.error("Auto capture failed:", err.message);
  });
}

let captureState = {
  running: false,
  lastRun: null,
  lastResults: [],
  error: null,
  progress: null,
  signalAnalysis: emptySignalAnalysis(),
};

function statusPayload() {
  return {
    running: captureState.running,
    lastRun: captureState.lastRun,
    lastResults: captureState.lastResults,
    error: captureState.error,
    progress: captureState.progress,
    signalAnalysis: captureState.signalAnalysis,
    nextCaptureAt,
    autoRefreshEnabled: settings.autoRefreshEnabled,
  };
}

function settingsPayload() {
  return publicSettings(settings);
}

function scheduleAutoRefresh() {
  scheduleNextAutoCapture();
}

async function runCapture(trigger = "manual", options = {}) {
  const coinId = options.coinId || null;
  const group = options.group || null;
  const isPartial = Boolean(coinId || (group && group !== "all"));

  if (captureState.running || captureState.signalAnalysis?.running) {
    return { skipped: true, reason: "Capture already in progress" };
  }

  captureState.running = true;
  captureState.error = null;
  captureState.progress = null;

  try {
    const allCoins = await getCoins();
    const activeCoins = allCoins.filter((c) => c.enabled);

    let captureList;
    if (coinId) {
      const coin = allCoins.find((c) => c.id === coinId);
      if (!coin) {
        throw new Error(`Coin "${coinId}" not found`);
      }
      if (!coin.enabled) {
        throw new Error(`Coin "${coinId}" is disabled`);
      }
      captureList = [coin];
    } else if (group && group !== "all") {
      captureList = activeCoins.filter((c) => c.group === group);
      if (captureList.length === 0) {
        throw new Error(`No enabled coins in group "${group}"`);
      }
    } else {
      captureList = activeCoins;
      if (captureList.length === 0) {
        throw new Error("No enabled coins to capture");
      }
    }

    const coinIds = captureList.map((c) => c.id);

    captureState.progress = {
      total: captureList.length,
      current: 0,
      currentCoin: null,
      partialResults: [],
      singleCoin: coinId || null,
      group: group && group !== "all" ? group : null,
    };

    if (!isPartial) {
      captureState.lastResults = [];
    }

    const results = await captureAllCoins({
      coinIds,
      onProgress: (event) => {
        if (event.phase === "start") {
          captureState.progress.current = event.current;
          captureState.progress.currentCoin = event.coin;
          captureState.progress.currentCoinStartedAt = event.startedAt || Date.now();
          captureState.progress.retryAttempt = null;
          captureState.progress.retryMax = null;
          captureState.progress.retryReason = null;
        } else if (event.phase === "retry") {
          captureState.progress.current = event.current;
          captureState.progress.currentCoin = event.coin;
          captureState.progress.retryAttempt = event.attempt;
          captureState.progress.retryMax = event.maxRetries;
          captureState.progress.retryReason = event.reason;
        } else if (event.phase === "done") {
          captureState.progress.partialResults.push(event.result);
          captureState.progress.currentCoin = null;
          captureState.progress.currentCoinStartedAt = null;
          captureState.progress.retryAttempt = null;
          captureState.progress.retryMax = null;
          captureState.progress.retryReason = null;

          if (isPartial) {
            const others = captureState.lastResults.filter(
              (r) => r.coin !== event.result.coin
            );
            captureState.lastResults = [...others, event.result];
          } else {
            captureState.lastResults = [...captureState.progress.partialResults];
          }
        }
      },
    });

    if (isPartial) {
      const merged = [...captureState.lastResults];
      for (const result of results) {
        const idx = merged.findIndex((r) => r.coin === result.coin);
        if (idx >= 0) merged[idx] = result;
        else merged.push(result);
      }
      captureState.lastResults = merged;
    } else {
      captureState.lastResults = results;
    }

    captureState.lastRun = { at: new Date().toISOString(), trigger, group, coinId };

    if (results.length > 0) {
      await refreshPrices(captureList, { rotatePrevious: true }).catch((err) => {
        console.error("Price refresh failed:", err.message);
      });

      const priceStore = await loadPriceStore().catch(() => ({ current: {} }));
      const snapshotPrices = {};
      for (const coin of captureList) {
        if (priceStore.current?.[coin.id]?.price != null) {
          snapshotPrices[coin.id] = priceStore.current[coin.id].price;
        }
      }

      const archived = await archiveScreenshotSet({
        trigger: coinId
          ? `${trigger}:${coinId}`
          : group && group !== "all"
            ? `${trigger}:${group}`
            : trigger,
        coins: captureList,
        results,
        prices: Object.keys(snapshotPrices).length ? snapshotPrices : null,
      });

      const okIds = results
        .filter((r) => r.status === "ok" && !r.chartPending)
        .map((r) => r.coin);
      if (okIds.length > 0) {
        captureState.progress = null;
        await runSignalAnalysis(okIds, archived.id).catch((err) => {
          console.error("Chart signal analysis failed:", err.message);
        });
      }
    }

    return { ok: true, results };
  } catch (err) {
    captureState.error = err.message;
    throw err;
  } finally {
    captureState.running = false;
    captureState.progress = null;
    if (!isPartial) {
      scheduleNextAutoCapture();
    }
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/screenshots", express.static(SCREENSHOTS_DIR));

app.get("/api/settings", (_req, res) => {
  res.json({ settings: settingsPayload() });
});

app.put("/api/settings", async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};

    const keys = [
      "autoRefreshMinutes",
      "columnsPerRow",
      "chartLayoutId",
      "chartInterval",
      "alertThresholdPercent",
      "historyPerPage",
      "screenshotWaitSeconds",
      "chartLoadMaxRetries",
      "autoTradeEnabled",
      "binanceApiKey",
      "binanceApiSecret",
      "binanceTestnet",
      "tradeAmountUsdt",
      "tradeLeverage",
      "tradeMarginType",
      "tradeMode",
      "tradeTpPercent",
      "tradeSlPercent",
    ];

    for (const key of keys) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
      }
    }

    settings = await updateSettings(patch);
    scheduleAutoRefresh();
    res.json({ settings: settingsPayload() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/groups", (_req, res) => {
  res.json({ groups: GROUPS });
});

app.post("/api/binance/test", async (_req, res) => {
  try {
    const result = await testBinanceConnection(settings);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/trades", async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const trades = await listTrades(limit);
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/trades/:id", async (req, res) => {
  try {
    const trade = await getTradeById(req.params.id);
    if (!trade) {
      return res.status(404).json({ error: "Trade not found" });
    }
    res.json({ trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/trades/:id/rerun", async (req, res) => {
  if (captureState.running) {
    return res.status(409).json({ error: "Screenshot capture in progress — try again shortly" });
  }

  try {
    const trade = await rerunTradeById(req.params.id, settings);
    if (trade?.skipped) {
      return res.status(400).json({ error: trade.reason || "Trade was skipped", trade });
    }
    res.json({ trade });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/pnl-report", async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const report = await getPnLReport(settings, { days });
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/local-trade-analysis", async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const coinId = req.query.coinId || null;
    const result = await runLocalTradeAnalysis({ days, coinId });
    res.json({ analysis: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signal-stats", async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 1));
    const coins = await getActiveCoins();
    const stats = await getSignalStats({
      days,
      coinIds: coins.map((c) => c.id),
    });

    const coinMap = Object.fromEntries(coins.map((c) => [c.id, c]));
    res.json({
      days: stats.days,
      rolling24h: stats.rolling24h,
      sinceAt: stats.sinceAt,
      untilAt: stats.untilAt,
      totals: stats.totals,
      guidelinePassPercent: stats.guidelinePassPercent ?? 70,
      coins: stats.coins.map((row) => ({
        ...row,
        name: coinMap[row.coinId]?.name || row.coinId,
        symbol: coinMap[row.coinId]?.symbol || "",
        group: coinMap[row.coinId]?.group || "",
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/signal-details", async (req, res) => {
  try {
    const coinId = String(req.query.coinId || "").trim();
    const kind = String(req.query.kind || "").trim();
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 1));

    if (!coinId || !kind) {
      return res.status(400).json({ error: "coinId and kind are required" });
    }

    const result = await getSignalBarDetails({ coinId, kind, days });
    res.json({ detail: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/coins", async (_req, res) => {
  try {
    const allCoins = await getCoins();
    const activeCoins = allCoins.filter((c) => c.enabled);
    await refreshPrices(activeCoins, { rotatePrevious: false }).catch(() => {});
    const alerts = await getAlerts(activeCoins, settings.alertThresholdPercent ?? 3);
    const signals = await getSignals();

    res.json({
      coins: allCoins.map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        group: c.group,
        pinned: c.pinned,
        enabled: c.enabled,
        imageUrl: `/screenshots/current/${c.id}.png`,
        alert: alerts[c.id] || null,
        chartSignal: signals[c.id] || {
          signal: "none",
          position: null,
          highlight: null,
          markers: null,
        },
      })),
      groups: GROUPS,
      state: statusPayload(),
      settings: settingsPayload(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/coins", async (req, res) => {
  try {
    const coin = await addCoin(req.body);
    res.status(201).json({ coin });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/coins/:id", async (req, res) => {
  try {
    const coin = await updateCoin(req.params.id, req.body);
    res.json({ coin });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete("/api/coins/:id", async (req, res) => {
  try {
    const coin = await removeCoin(req.params.id);
    res.json({ coin });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get("/api/history", async (_req, res) => {
  try {
    const sets = await listSets();
    res.json({ sets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/history/:id", async (req, res) => {
  try {
    const set = await getSet(req.params.id);
    res.json({
      set: {
        ...set,
        images: set.images.map((coinId) => ({
          coinId,
          url: `/screenshots/history/${set.id}/${coinId}.png`,
        })),
      },
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/capture", async (req, res) => {
  if (captureState.running) {
    return res.status(409).json({ error: "Capture already in progress" });
  }

  const coinId = req.body?.coinId || null;
  const group = req.body?.group || null;
  res.json({ started: true, coinId, group });

  const trigger = coinId ? "single" : group && group !== "all" ? `group:${group}` : "manual";
  runCapture(trigger, { coinId, group }).catch((err) => {
    console.error("Capture failed:", err.message);
  });
});

app.post("/api/capture/:coinId", async (req, res) => {
  if (captureState.running) {
    return res.status(409).json({ error: "Capture already in progress" });
  }

  const coinId = req.params.coinId;
  res.json({ started: true, coinId });

  runCapture("single", { coinId }).catch((err) => {
    console.error(`Single capture failed (${coinId}):`, err.message);
  });
});

app.post("/api/auto-refresh", async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }

  settings = await updateSettings({ autoRefreshEnabled: enabled });
  scheduleNextAutoCapture();
  console.log(`Auto-refresh ${enabled ? "started" : "stopped"}`);
  res.json({ settings: settingsPayload() });
});

app.get("/api/tradingview/session", async (_req, res) => {
  try {
    const session = await getSessionStatus();
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tradingview/login", async (_req, res) => {
  if (captureState.running) {
    return res
      .status(409)
      .json({ error: "Wait for the current capture to finish first." });
  }

  try {
    const result = await openLoginBrowser();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/tradingview/login/save", async (_req, res) => {
  try {
    const session = await closeLoginBrowser();
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({
    ...statusPayload(),
    settings: settingsPayload(),
  });
});

app.listen(PORT, async () => {
  settings = await getSettings();
  console.log(`Dashboard: http://localhost:${PORT}`);

  scheduleAutoRefresh();

  const coins = await getActiveCoins();
  if (coins.length > 0) {
    console.log("Starting initial screenshot capture...");
    runCapture("startup").catch((err) => {
      console.error("Startup capture failed:", err.message);
    });
  } else {
    console.log("No coins configured — add coins from the dashboard.");
  }
});
