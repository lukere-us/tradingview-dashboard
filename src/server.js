const express = require("express");
const path = require("path");
const { captureAllCoins } = require("./services/screenshotter");
const { getCoins, addCoin, updateCoin, removeCoin, GROUPS } = require("./services/coinsStore");
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
} = require("./services/settingsStore");
const {
  getSessionStatus,
  openLoginBrowser,
  closeLoginBrowser,
} = require("./services/tradingviewSession");
const { getAlerts, refreshPrices } = require("./services/priceAlerts");

const app = express();
const PORT = process.env.PORT || 3002;

let settings = {
  autoRefreshMinutes: 5,
  columnsPerRow: 3,
  autoRefreshEnabled: true,
};
let autoRefreshTimer = null;

let captureState = {
  running: false,
  lastRun: null,
  lastResults: [],
  error: null,
  progress: null,
};

function statusPayload() {
  return {
    running: captureState.running,
    lastRun: captureState.lastRun,
    lastResults: captureState.lastResults,
    error: captureState.error,
    progress: captureState.progress,
  };
}

function settingsPayload() {
  return {
    autoRefreshMinutes: settings.autoRefreshMinutes,
    columnsPerRow: settings.columnsPerRow,
    autoRefreshEnabled: settings.autoRefreshEnabled,
    autoRefreshMs: autoRefreshMs(settings),
    chartLayoutId: settings.chartLayoutId || "",
    chartInterval: settings.chartInterval || "15",
    alertThresholdPercent: settings.alertThresholdPercent ?? 3,
  };
}

function scheduleAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  const interval = autoRefreshMs(settings);
  autoRefreshTimer = setInterval(() => {
    if (settings.autoRefreshEnabled && !captureState.running) {
      console.log("Auto-refresh: capturing screenshots...");
      runCapture("auto").catch((err) => {
        console.error("Auto capture failed:", err.message);
      });
    }
  }, interval);
}

async function runCapture(trigger = "manual", options = {}) {
  const coinId = options.coinId || null;
  const group = options.group || null;

  if (captureState.running) {
    return { skipped: true, reason: "Capture already in progress" };
  }

  captureState.running = true;
  captureState.error = null;
  captureState.progress = null;

  try {
    const allCoins = await getCoins();

    let captureList;
    if (coinId) {
      if (!allCoins.some((c) => c.id === coinId)) {
        throw new Error(`Coin "${coinId}" not found`);
      }
      captureList = allCoins.filter((c) => c.id === coinId);
    } else if (group && group !== "all") {
      captureList = allCoins.filter((c) => c.group === group);
      if (captureList.length === 0) {
        throw new Error(`No coins in group "${group}"`);
      }
    } else {
      captureList = allCoins;
    }

    const coinIds = captureList.map((c) => c.id);
    const isPartial = Boolean(coinId || (group && group !== "all"));

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
        } else if (event.phase === "done") {
          captureState.progress.partialResults.push(event.result);
          captureState.progress.currentCoin = null;
          captureState.progress.currentCoinStartedAt = null;

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
      await archiveScreenshotSet({
        trigger: coinId
          ? `${trigger}:${coinId}`
          : group && group !== "all"
            ? `${trigger}:${group}`
            : trigger,
        coins: captureList,
        results,
      });

      await refreshPrices(captureList, { rotatePrevious: true }).catch((err) => {
        console.error("Price refresh failed:", err.message);
      });
    }

    return { ok: true, results };
  } catch (err) {
    captureState.error = err.message;
    throw err;
  } finally {
    captureState.running = false;
    captureState.progress = null;
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
    const { autoRefreshMinutes, columnsPerRow, chartLayoutId, chartInterval, alertThresholdPercent } =
      req.body;
    const patch = {};

    if (autoRefreshMinutes !== undefined) {
      patch.autoRefreshMinutes = autoRefreshMinutes;
    }
    if (columnsPerRow !== undefined) {
      patch.columnsPerRow = columnsPerRow;
    }
    if (chartLayoutId !== undefined) {
      patch.chartLayoutId = chartLayoutId;
    }
    if (chartInterval !== undefined) {
      patch.chartInterval = chartInterval;
    }
    if (alertThresholdPercent !== undefined) {
      patch.alertThresholdPercent = alertThresholdPercent;
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

app.get("/api/coins", async (_req, res) => {
  try {
    const coins = await getCoins();
    await refreshPrices(coins, { rotatePrevious: false }).catch(() => {});
    const alerts = await getAlerts(coins, settings.alertThresholdPercent ?? 3);

    res.json({
      coins: coins.map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        group: c.group,
        pinned: c.pinned,
        imageUrl: `/screenshots/current/${c.id}.png`,
        alert: alerts[c.id] || null,
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

  const coins = await getCoins();
  if (coins.length > 0) {
    console.log("Starting initial screenshot capture...");
    runCapture("startup").catch((err) => {
      console.error("Startup capture failed:", err.message);
    });
  } else {
    console.log("No coins configured — add coins from the dashboard.");
  }
});
