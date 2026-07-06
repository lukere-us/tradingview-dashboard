const views = {
  dashboard: document.getElementById("view-dashboard"),
  history: document.getElementById("view-history"),
  coins: document.getElementById("view-coins"),
  compare: document.getElementById("view-compare"),
  signals: document.getElementById("view-signals"),
  trades: document.getElementById("view-trades"),
  localAnalyze: document.getElementById("view-local-analyze"),
  settings: document.getElementById("view-settings"),
};

const dashboardGrid = document.getElementById("dashboardGrid");
const groupFilters = document.getElementById("groupFilters");
const refreshGroupBtn = document.getElementById("refreshGroupBtn");
const refreshBtn = document.getElementById("refreshBtn");
const autoRefreshBtn = document.getElementById("autoRefreshBtn");
const statusBadge = document.getElementById("statusBadge");
const lastRunEl = document.getElementById("lastRun");
const autoRefreshEl = document.getElementById("autoRefresh");
const gridLayoutEl = document.getElementById("gridLayout");

const historyList = document.getElementById("historyList");
const historyPagination = document.getElementById("historyPagination");
const historyDetail = document.getElementById("historyDetail");
const historyMeta = document.getElementById("historyMeta");
const historyGrid = document.getElementById("historyGrid");
const historyBackBtn = document.getElementById("historyBackBtn");

const addCoinForm = document.getElementById("addCoinForm");
const coinFormError = document.getElementById("coinFormError");
const coinsTable = document.getElementById("coinsTable");

const settingsForm = document.getElementById("settingsForm");
const settingsFormError = document.getElementById("settingsFormError");
const settingsFormSuccess = document.getElementById("settingsFormSuccess");
const tvSessionStatus = document.getElementById("tvSessionStatus");
const tvLoginBtn = document.getElementById("tvLoginBtn");
const tvSaveLoginBtn = document.getElementById("tvSaveLoginBtn");
const binanceTestBtn = document.getElementById("binanceTestBtn");
const binanceTestStatus = document.getElementById("binanceTestStatus");
const binanceKeyStatus = document.getElementById("binanceKeyStatus");
const binanceSecretStatus = document.getElementById("binanceSecretStatus");
const tradeLogTable = document.getElementById("tradeLogTable");

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxCaption = document.getElementById("lightboxCaption");
const compareGrid = document.getElementById("compareGrid");
const clearCompareBtn = document.getElementById("clearCompareBtn");
const signalDaysSelect = document.getElementById("signalDaysSelect");
const refreshSignalChartBtn = document.getElementById("refreshSignalChartBtn");
const signalChartSummary = document.getElementById("signalChartSummary");
const signalChartBars = document.getElementById("signalChartBars");
const signalChartTable = document.getElementById("signalChartTable");
const signalChartModal = document.getElementById("signalChartModal");
const signalModalTitle = document.getElementById("signalModalTitle");
const signalModalSubtitle = document.getElementById("signalModalSubtitle");
const signalModalBody = document.getElementById("signalModalBody");

const SIGNAL_KIND_LABELS = {
  buy: "Buy signals",
  passedBuy: "Passed buy",
  sell: "Sell signals",
  passedSell: "Passed sell",
};

const tradeJournalFilter = document.getElementById("tradeJournalFilter");
const pnlDaysSelect = document.getElementById("pnlDaysSelect");
const pnlReportSection = document.getElementById("pnlReportSection");
const refreshTradeJournalBtn = document.getElementById("refreshTradeJournalBtn");
const tradeJournalSummary = document.getElementById("tradeJournalSummary");
const tradeJournalList = document.getElementById("tradeJournalList");
const tradeJournalPagination = document.getElementById("tradeJournalPagination");
const tradeJournalDetail = document.getElementById("tradeJournalDetail");

let cachedTradeJournal = [];
let cachedPnLReport = null;
let selectedTradeId = null;
let tradeJournalPage = 1;
const TRADE_JOURNAL_PER_PAGE = 10;

const localAnalyzeDays = document.getElementById("localAnalyzeDays");
const runLocalAnalyzeBtn = document.getElementById("runLocalAnalyzeBtn");
const localAnalyzeStatus = document.getElementById("localAnalyzeStatus");
const localAnalyzeSummary = document.getElementById("localAnalyzeSummary");
const localAnalyzeCoinTable = document.getElementById("localAnalyzeCoinTable");
const localAnalyzeListHeader = document.getElementById("localAnalyzeListHeader");
const localAnalyzeList = document.getElementById("localAnalyzeList");
const localAnalyzeDetail = document.getElementById("localAnalyzeDetail");

let cachedLocalAnalysis = null;
let cachedLocalAnalyzeKey = null;
let selectedLocalSimId = null;
let selectedLocalAnalyzeCoinId = null;

let statusPollTimer = null;
let autoWatchTimer = null;
let currentView = "dashboard";
let cachedCoins = [];
let cachedGroups = [];
let activeGroup = "all";
let compareSelection = new Set();
let lastRenderedAt = null;
let lastProgressKey = "";
let lastSignalAnalysisKey = "";
let cachedHistorySets = [];
let historyPage = 1;
let currentSettings = {
  autoRefreshMinutes: 5,
  columnsPerRow: 3,
  autoRefreshEnabled: true,
  autoRefreshMs: 300000,
  chartInterval: "15",
  chartLayoutId: "",
  alertThresholdPercent: 3,
  historyPerPage: 10,
};

function tradingViewLink(symbol) {
  const params = new URLSearchParams({
    symbol,
    interval: currentSettings.chartInterval || "15",
  });

  const layoutId = currentSettings.chartLayoutId?.trim();
  if (layoutId) {
    return `https://www.tradingview.com/chart/${layoutId}/?${params.toString()}`;
  }

  return `https://www.tradingview.com/chart/?${params.toString()}`;
}

function binanceLink(symbol) {
  const pair = symbol.replace(/^[^:]+:/i, "").toUpperCase();
  return `https://www.binance.com/en/futures/${pair}`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function applyGridColumns(columns) {
  document.querySelectorAll(".grid").forEach((grid) => {
    grid.style.setProperty("--grid-cols", columns);
  });
}

function applySettings(settings) {
  currentSettings = settings;
  applyGridColumns(settings.columnsPerRow);
  gridLayoutEl.textContent = `Layout: ${settings.columnsPerRow} per row`;
  updateAutoRefreshUI(settings.autoRefreshEnabled, settings.autoRefreshMs);
}

function setBadge(text, className) {
  statusBadge.textContent = text;
  statusBadge.className = `badge ${className}`;
}

function openLightbox(src, caption) {
  lightboxImg.src = src;
  lightboxImg.alt = caption;
  lightboxCaption.textContent = caption;
  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImg.src = "";
  document.body.style.overflow = "";
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

function getTitleDuration(coinId, { running, progress, resultMap }) {
  const fromResult = resultMap[coinId]?.durationMs;
  if (fromResult != null) return formatDuration(fromResult);

  if (running && progress) {
    const partial = progress.partialResults?.find((r) => r.coin === coinId);
    if (partial?.durationMs != null) return formatDuration(partial.durationMs);
  }

  return "";
}

function progressKey(progress) {
  if (!progress) return "";
  const done = progress.partialResults?.map((r) => `${r.coin}:${r.status}`).join(",") || "";
  return `${progress.currentCoin || ""}|${done}`;
}

function signalAnalysisKey(signalAnalysis) {
  if (!signalAnalysis) return "";
  if (signalAnalysis.running) {
    return `run:${signalAnalysis.current || ""}|${signalAnalysis.completed?.join(",") || ""}`;
  }
  return `done:${signalAnalysis.completed?.join(",") || ""}`;
}

function isCaptureTarget(coin, progress) {
  if (!progress) return true;
  if (progress.singleCoin) {
    return progress.singleCoin === coin.id || progress.currentCoin === coin.id;
  }
  if (progress.group) {
    return coin.group === progress.group;
  }
  return true;
}

function filterCoinsForView(coins) {
  if (activeGroup === "all") return coins;
  return coins.filter((c) => c.group === activeGroup);
}

function formatPrice(price) {
  if (price == null) return "—";
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function renderAlertBadges(alert) {
  if (!alert || alert.status !== "ok") return "";

  const parts = [];
  if (alert.nearHigh) {
    parts.push('<span class="alert-badge high">24H HIGH</span>');
  } else if (alert.nearLow) {
    parts.push('<span class="alert-badge low">24H LOW</span>');
  }

  if (alert.changeSinceCapture != null) {
    const sign = alert.changeSinceCapture >= 0 ? "+" : "";
    const cls = alert.bigMove
      ? alert.changeSinceCapture >= 0
        ? "up"
        : "down"
      : "flat";
    parts.push(
      `<span class="alert-badge ${cls}">${sign}${alert.changeSinceCapture.toFixed(1)}% SS</span>`
    );
  }

  if (alert.change24h != null) {
    const sign = alert.change24h >= 0 ? "+" : "";
    parts.push(
      `<span class="alert-badge flat">${sign}${alert.change24h.toFixed(1)}% 24h</span>`
    );
  }

  if (parts.length === 0) return "";
  return `<div class="alert-badges">${parts.join("")}</div>`;
}

function signalHighlightClass(chartSignal) {
  if (!chartSignal?.highlight) return "";
  return `signal-${chartSignal.highlight}`;
}

function renderTitleSignalResult(chartSignal) {
  // Only show a live label on the last 3 candles. Memory (no-repeat) stays server-side.
  const live = chartSignal?.signal;
  if (!live || live === "none") {
    return "";
  }

  const label = live.toUpperCase();
  const pos =
    chartSignal.position === "top"
      ? " top"
      : chartSignal.position === "bottom"
        ? " bottom"
        : "";
  const cls = chartSignal.highlight || live;

  return `<span class="card-analyze-status ${cls}"> · ${label}${pos}</span>`;
}

function renderTitleAnalyzeStatus(coin, { signalAnalysis, chartSignal }) {
  const queue = signalAnalysis?.queue || [];
  const inQueue = queue.includes(coin.id);

  if (signalAnalysis?.running && inQueue) {
    if (signalAnalysis.current === coin.id) {
      return `<span class="card-analyze-status analyzing"> · Scanning last 3 candles…</span>`;
    }
    if (signalAnalysis.completed?.includes(coin.id)) {
      const sig = signalAnalysis.results?.[coin.id] || chartSignal;
      return renderTitleSignalResult(sig);
    }
    return `<span class="card-analyze-status waiting"> · Waiting for analysis…</span>`;
  }

  if (chartSignal?.analyzedAt || (chartSignal && chartSignal.signal !== undefined)) {
    return renderTitleSignalResult(chartSignal);
  }

  return "";
}

function getCoinVisualState(coin, { running, progress, resultMap }) {
  const result = resultMap[coin.id];

  if (running && progress) {
    if (!isCaptureTarget(coin, progress)) {
      if (result?.status === "error") {
        return { type: "error", error: result.error };
      }
      return { type: "image", live: false };
    }

    const partial = progress.partialResults?.find((r) => r.coin === coin.id);
    if (partial?.status === "error") {
      return { type: "error", error: partial.error };
    }
    if (partial?.status === "ok") {
      return { type: "image", live: true };
    }
    if (progress.currentCoin === coin.id) {
      if (progress.retryAttempt && progress.retryMax) {
        return {
          type: "loading",
          label: `Retry ${progress.retryAttempt}/${progress.retryMax}…`,
        };
      }
      return { type: "loading", label: "Capturing..." };
    }
    return { type: "waiting", label: "Waiting..." };
  }

  if (result?.status === "error") {
    return { type: "error", error: result.error };
  }

  return { type: "image", live: false };
}

function renderCardImage(coin, imageUrl, visual, cacheBust) {
  if (visual.type === "loading") {
    return `
      <div class="card-loading">
        <div class="spinner-sm" aria-hidden="true"></div>
        <span>Capturing... <strong class="card-loading-timer">0.0s</strong></span>
      </div>
    `;
  }

  if (visual.type === "waiting") {
    return `<div class="card-loading waiting"><span>${visual.label}</span></div>`;
  }

  if (visual.type === "error") {
    return `<div class="placeholder">Capture failed</div>`;
  }

  const bust = cacheBust ? `?t=${encodeURIComponent(cacheBust)}` : "";
  const fullSrc = `${imageUrl}${bust}`;

  return `
    <img
      class="ss-thumb"
      src="${fullSrc}"
      alt="${coin.name} chart"
      data-full-src="${fullSrc}"
      data-caption="${coin.name} (${coin.symbol})"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
    />
    <div class="placeholder" style="display:none">No screenshot yet</div>
  `;
}

let durationTickTimer = null;
let liveCaptureProgress = null;

function stopDurationTicker() {
  if (durationTickTimer) {
    clearInterval(durationTickTimer);
    durationTickTimer = null;
  }
  liveCaptureProgress = null;
}

function updateDurationLabels() {
  const progress = liveCaptureProgress;
  if (!progress) return;

  const now = Date.now();

  dashboardGrid.querySelectorAll("[data-coin-id]").forEach((card) => {
    const coinId = card.dataset.coinId;
    const headerDuration = card.querySelector(".card-duration");
    const loadTimer = card.querySelector(".card-loading-timer");
    if (!headerDuration) return;

    const partial = progress.partialResults?.find((r) => r.coin === coinId);
    if (partial?.durationMs != null) {
      const label = formatDuration(partial.durationMs);
      headerDuration.textContent = ` · ${label}`;
      if (loadTimer) loadTimer.textContent = "";
      return;
    }

    if (progress.currentCoin === coinId && progress.currentCoinStartedAt) {
      const label = progress.retryAttempt
        ? `Retry ${progress.retryAttempt}/${progress.retryMax}`
        : formatDuration(now - progress.currentCoinStartedAt);
      headerDuration.textContent = ` · ${label}`;
      if (loadTimer) loadTimer.textContent = label;
      return;
    }

    if (!partial) {
      headerDuration.textContent = "";
      if (loadTimer) loadTimer.textContent = "";
    }
  });
}

function startDurationTicker(progress) {
  liveCaptureProgress = progress;
  updateDurationLabels();
  if (durationTickTimer) return;
  durationTickTimer = setInterval(updateDurationLabels, 100);
}

function attachCoinRefreshHandlers(container, captureRunning) {
  container.querySelectorAll("[data-refresh-coin]").forEach((btn) => {
    btn.disabled = captureRunning;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      refreshSingleCoin(btn.dataset.refreshCoin);
    });
  });
}

function attachScreenshotHandlers(container) {
  container.querySelectorAll(".ss-thumb").forEach((img) => {
    const wrap = img.closest(".card-image-wrap");
    if (wrap) wrap.classList.add("is-clickable");

    img.addEventListener("click", () => {
      openLightbox(img.dataset.fullSrc, img.dataset.caption);
    });
  });
}

function showView(name) {
  currentView = name;
  const viewKey = name === "local-analyze" ? "localAnalyze" : name;
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === viewKey);
  });

  if (name === "history") refreshHistoryList();
  if (name === "coins") loadCoinsTable();
  if (name === "settings") loadSettingsForm();
  if (name === "compare") renderCompareView();
  if (name === "signals") {
    if (signalDaysSelect) signalDaysSelect.value = "1";
    loadSignalChart();
  }
  if (name === "trades") loadTradeJournal();
  if (name === "local-analyze") loadLocalAnalyze({ forceToday: true });
}

function renderGroupFilters() {
  const groups = [{ id: "all", label: "All" }, ...cachedGroups];
  groupFilters.innerHTML = groups
    .map(
      (g) => `
      <button type="button" class="group-filter ${activeGroup === g.id ? "active" : ""}" data-group="${g.id}">
        ${g.label}
      </button>
    `
    )
    .join("");

  groupFilters.querySelectorAll(".group-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeGroup = btn.dataset.group;
      renderGroupFilters();
      refreshDashboard({ forceImages: false });
    });
  });

  refreshGroupBtn.disabled = activeGroup === "all";
  refreshGroupBtn.textContent =
    activeGroup === "all" ? "Refresh Group" : `Refresh ${activeGroup}`;
}

function renderCoinGrid(container, coins, options = {}) {
  const {
    resultMap = {},
    imageBase = "",
    cacheBust = "",
    running = false,
    progress = null,
    signalAnalysis = null,
    showActions = true,
  } = options;

  if (coins.length === 0) {
    container.innerHTML = `<p class="empty-state">No coins in this group. Add coins or change the filter.</p>`;
    return;
  }

  container.innerHTML = coins
    .map((coin) => {
      const imageUrl = coin.imageUrl || `${imageBase}${coin.id}.png`;
      const visual = getCoinVisualState(coin, { running, progress, resultMap });
      const titleDuration = getTitleDuration(coin.id, { running, progress, resultMap });
      const coinBust =
        visual.type === "image" && visual.live
          ? `live-${coin.id}-${progress?.partialResults?.length || 0}`
          : cacheBust;
      const picked = compareSelection.has(coin.id);
      const signalClass = signalHighlightClass(coin.chartSignal);

      return `
        <article class="card ${coin.pinned ? "pinned-card" : ""}" data-coin-id="${coin.id}">
          <div class="card-header">
            <div class="card-title-row">
              <h3>${coin.name}<span class="card-duration">${titleDuration ? ` · ${titleDuration}` : ""}</span>${renderTitleAnalyzeStatus(coin, { signalAnalysis, chartSignal: coin.chartSignal })}</h3>
              ${
                showActions
                  ? `<div class="card-header-actions">
                      <button type="button" class="btn-pin ${coin.pinned ? "active" : ""}" data-pin-coin="${coin.id}" title="Pin ${coin.name}">★</button>
                      <button type="button" class="btn-compare-pick ${picked ? "active" : ""}" data-compare-coin="${coin.id}" title="Add to compare">⇔</button>
                      <button type="button" class="btn-coin-refresh" data-refresh-coin="${coin.id}" title="Refresh ${coin.name}" ${running ? "disabled" : ""}>↻</button>
                    </div>`
                  : ""
              }
            </div>
            <div class="card-meta-row">
              <span class="card-symbol">${coin.symbol} · ${coin.group}</span>
              ${renderAlertBadges(coin.alert)}
            </div>
          </div>
          <div class="card-image-wrap ${signalClass}">
            ${renderCardImage(coin, imageUrl, visual, coinBust)}
          </div>
          <div class="card-footer">
            <a href="${tradingViewLink(coin.symbol)}" target="_blank" rel="noopener">Open on TradingView</a>
            · <a href="${binanceLink(coin.symbol)}" target="_blank" rel="noopener">Open on Binance Futures</a>
            ${coin.alert?.price != null ? ` · $${formatPrice(coin.alert.price)}` : ""}
            ${visual.type === "error" ? ` · <span class="text-error">${visual.error}</span>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  attachScreenshotHandlers(container);
  if (showActions) {
    attachCoinRefreshHandlers(container, running);
    attachPinCompareHandlers(container, running);
  }

  if (running && progress) {
    startDurationTicker(progress);
  }
}

function attachPinCompareHandlers(container, captureRunning) {
  container.querySelectorAll("[data-pin-coin]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePin(btn.dataset.pinCoin);
    });
  });

  container.querySelectorAll("[data-compare-coin]").forEach((btn) => {
    btn.disabled = false;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleComparePick(btn.dataset.compareCoin);
    });
  });
}

async function togglePin(coinId) {
  const coin = cachedCoins.find((c) => c.id === coinId);
  if (!coin) return;

  try {
    const res = await fetch(`/api/coins/${encodeURIComponent(coinId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !coin.pinned }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);
    await refreshDashboard({ reRender: true });
    if (currentView === "coins") await loadCoinsTable();
  } catch (err) {
    alert(err.message || "Failed to update pin");
  }
}

function toggleComparePick(coinId) {
  if (compareSelection.has(coinId)) {
    compareSelection.delete(coinId);
  } else {
    if (compareSelection.size >= 4) {
      alert("Compare supports up to 4 coins. Remove one first.");
      return;
    }
    compareSelection.add(coinId);
  }
  refreshDashboard({ reRender: true });
}

function formatDayLabel(day) {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function loadSignalChart() {
  const days = Number(signalDaysSelect?.value) || 1;
  signalChartSummary.innerHTML = `<p>Loading signal stats…</p>`;
  signalChartBars.innerHTML = "";
  signalChartTable.innerHTML = "";

  try {
    const res = await fetch(`/api/signal-stats?days=${encodeURIComponent(days)}`);
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    renderSignalChart(data);
  } catch (err) {
    signalChartSummary.innerHTML = `<p class="text-error">${err.message || "Failed to load signal stats."}</p>`;
  }
}

function signalChartYMax(coins) {
  const peak = Math.max(
    0,
    ...coins.map((c) =>
      Math.max(
        c.totals.buy || 0,
        c.totals.sell || 0,
        c.totals.passedBuy || 0,
        c.totals.passedSell || 0
      )
    )
  );
  if (peak <= 4) return 4;
  return Math.ceil(peak / 2) * 2;
}

function renderGuidelineAnalysisBody(entry) {
  const analysis = entry.analysis || {};
  const chart = analysis.chartSignal || {};
  const settings = analysis.tradeSettings || {};
  const screenshot =
    entry.screenshotUrl || analysis.screenshotUrl || `/screenshots/current/${entry.coinId}.png`;

  if (!analysis.checklist?.length) {
    return `<p class="empty-state">No screenshot checklist available for this signal.</p>`;
  }

  const pos = chart.position ? ` (${chart.position})` : "";

  return `
    <div class="trade-detail-grid">
      <div class="trade-detail-chart">
        <h4>Chart at signal time</h4>
        <div class="trade-detail-image-wrap signal-detail-img ${chart.highlight ? `signal-${chart.highlight}` : ""}">
          <img src="${screenshot}?t=${encodeURIComponent(entry.at)}" alt="${entry.coinName || entry.coinId} chart" />
        </div>
        <p class="field-hint">
          Image signal: <strong>${(chart.signal || "none").toUpperCase()}${pos}</strong>
          ${chart.analyzedAt ? ` · analyzed ${formatTime(chart.analyzedAt)}` : ""}
        </p>
      </div>
      <div class="trade-detail-checklist">
        <h4>Future Trend Pro checklist</h4>
        <p class="field-hint">${analysis.guideSummary || "Future Trend Pro checklist — pass at ≥70%."}</p>
        ${renderChecklistTable(analysis.checklist)}
        ${
          analysis.guidelineFailures?.length && !analysis.guidelinesPassed
            ? `<div class="trade-block-reasons"><strong>Below 70% threshold:</strong><ul>${analysis.guidelineFailures.map((f) => `<li>${f}</li>`).join("")}</ul></div>`
            : analysis.guidelinesPassed
              ? `<p class="field-hint ok">Guidelines passed${analysis.guidelinePassPercent != null ? ` (${analysis.guidelinePassPercent}% complete)` : ""} — ≥70% required.</p>`
              : analysis.guidelinePassPercent != null
                ? `<p class="field-hint">Checklist ${analysis.guidelinePassPercent}% complete — need ≥70% to pass.</p>`
                : ""
        }
      </div>
    </div>
    <div class="trade-detail-panels">
      <div class="trade-detail-panel">
        <h4>Trade settings</h4>
        <ul class="trade-meta-list">
          <li>Amount: <strong>${settings.tradeAmountUsdt ?? "—"} USDT</strong></li>
          <li>Leverage: <strong>${settings.tradeLeverage ?? "—"}x</strong></li>
          <li>Mode: <strong>${settings.tradeMode ?? "—"}</strong></li>
          <li>Margin: <strong>${settings.tradeMarginType ?? "—"}</strong></li>
          <li>TP / SL: <strong>${settings.tradeTpPercent ?? "—"}% / ${settings.tradeSlPercent ?? "—"}%</strong></li>
          <li>Interval: <strong>${settings.chartInterval || "15"}m</strong></li>
          <li>Network: <strong>${settings.testnet ? "Testnet" : "Live"}</strong></li>
        </ul>
      </div>
    </div>
  `;
}

function bindSignalDetailImages(root, entry) {
  root?.querySelectorAll(".signal-detail-img img").forEach((img) => {
    img.addEventListener("click", () => {
      openLightbox(
        img.src,
        `${entry.coinName || entry.coinId} · ${(entry.signal || "").toUpperCase()}`
      );
    });
  });
}

function signalBarClass(kind) {
  if (kind === "buy") return "signal-col buy";
  if (kind === "passedBuy") return "signal-col passed buy";
  if (kind === "sell") return "signal-col sell";
  if (kind === "passedSell") return "signal-col passed sell";
  return "signal-col";
}

function signalBarClickAttrs(coin, kind, count) {
  const baseClass = signalBarClass(kind);
  if (!count) return `class="${baseClass}"`;
  return `class="${baseClass} signal-col-clickable" role="button" tabindex="0" data-coin-id="${coin.coinId}" data-coin-name="${coin.name}" data-signal-kind="${kind}" data-signal-count="${count}"`;
}

function closeSignalChartModal() {
  signalChartModal?.classList.add("hidden");
  document.body.style.overflow = "";
  if (signalModalBody) signalModalBody.innerHTML = "";
}

async function openSignalChartModal({ coinId, coinName, kind, days }) {
  if (!signalChartModal || !signalModalBody) return;

  const kindLabel = SIGNAL_KIND_LABELS[kind] || kind;
  signalModalTitle.textContent = `${coinName} · ${kindLabel}`;
  signalModalSubtitle.textContent = "Loading signals…";
  signalModalBody.innerHTML = `<p class="field-hint">Loading signal details…</p>`;
  signalChartModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  try {
    const res = await fetch(
      `/api/signal-details?coinId=${encodeURIComponent(coinId)}&kind=${encodeURIComponent(kind)}&days=${encodeURIComponent(days)}`
    );
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    const detail = data.detail || {};
    const signals = detail.signals || [];
    signalModalSubtitle.textContent = `${signals.length} signal${signals.length === 1 ? "" : "s"} in selected period · click each row to expand`;

    if (!signals.length) {
      signalModalBody.innerHTML = `<p class="empty-state">No signals in this bar for the selected period.</p>`;
      return;
    }

    signalModalBody.innerHTML = `
      <div class="signal-accordion">
        ${signals
          .map((entry, index) => {
            const passLabel =
              entry.guidelinePassPercent != null
                ? `${entry.guidelinePassPercent}%`
                : entry.guidelinesOk
                  ? "passed"
                  : entry.guidelinesOk === false
                    ? "below 70%"
                    : "—";
            const statusClass = entry.guidelinesOk
              ? "trade-status-ok"
              : entry.guidelinesOk === false
                ? "trade-status-blocked"
                : "";
            return `
          <details class="signal-accordion-item" ${index === 0 ? "open" : ""}>
            <summary class="signal-accordion-summary">
              <span class="signal-badge signal-${entry.signal || "none"}">${(entry.signal || "—").toUpperCase()}</span>
              <span class="signal-accordion-time">${formatTime(entry.at)}</span>
              <span class="trade-status-badge ${statusClass}">${passLabel}</span>
              ${entry.position ? `<span class="field-hint">${entry.position}</span>` : ""}
            </summary>
            <div class="signal-accordion-body">
              ${renderGuidelineAnalysisBody(entry)}
            </div>
          </details>
        `;
          })
          .join("")}
      </div>
    `;

    signalModalBody.querySelectorAll(".signal-accordion-item").forEach((item, index) => {
      bindSignalDetailImages(item, signals[index]);
    });
  } catch (err) {
    signalModalSubtitle.textContent = "";
    signalModalBody.innerHTML = `<p class="text-error">${err.message || "Failed to load signal details."}</p>`;
  }
}

function bindSignalChartBarClicks(days) {
  signalChartBars?.querySelectorAll("[data-signal-kind]").forEach((bar) => {
    const open = () => {
      const count = Number(bar.dataset.signalCount) || 0;
      if (count <= 0) return;
      openSignalChartModal({
        coinId: bar.dataset.coinId,
        coinName: bar.dataset.coinName,
        kind: bar.dataset.signalKind,
        days,
      });
    };
    bar.addEventListener("click", open);
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderSignalColumnChart(coins) {
  const yMax = signalChartYMax(coins);
  const ticks = [];
  for (let v = yMax; v >= 0; v -= Math.max(1, Math.round(yMax / 4))) {
    if (!ticks.includes(v)) ticks.push(v);
  }
  if (ticks[ticks.length - 1] !== 0) ticks.push(0);

  const groups = coins
    .map((coin) => {
      const buyH = yMax > 0 ? (coin.totals.buy / yMax) * 100 : 0;
      const sellH = yMax > 0 ? (coin.totals.sell / yMax) * 100 : 0;
      const passedBuyH = yMax > 0 ? ((coin.totals.passedBuy || 0) / yMax) * 100 : 0;
      const passedSellH = yMax > 0 ? ((coin.totals.passedSell || 0) / yMax) * 100 : 0;
      const buyCount = coin.totals.buy || 0;
      const sellCount = coin.totals.sell || 0;
      const passedBuyCount = coin.totals.passedBuy || 0;
      const passedSellCount = coin.totals.passedSell || 0;
      return `
        <div class="signal-col-group">
          <div class="signal-col-bars">
            <div
              ${signalBarClickAttrs(coin, "buy", buyCount)}
              style="height:${buyH}%"
              title="${coin.name}: ${buyCount} buy — click for details"
            >
              <span class="signal-col-value">${buyCount}</span>
            </div>
            <div
              ${signalBarClickAttrs(coin, "passedBuy", passedBuyCount)}
              style="height:${passedBuyH}%"
              title="${coin.name}: ${passedBuyCount} passed buy — click for details"
            >
              <span class="signal-col-value">${passedBuyCount}</span>
            </div>
            <div
              ${signalBarClickAttrs(coin, "sell", sellCount)}
              style="height:${sellH}%"
              title="${coin.name}: ${sellCount} sell — click for details"
            >
              <span class="signal-col-value">${sellCount}</span>
            </div>
            <div
              ${signalBarClickAttrs(coin, "passedSell", passedSellCount)}
              style="height:${passedSellH}%"
              title="${coin.name}: ${passedSellCount} passed sell — click for details"
            >
              <span class="signal-col-value">${passedSellCount}</span>
            </div>
          </div>
          <div class="signal-col-name">${coin.name}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="signal-column-chart">
      <div class="signal-chart-legend">
        <span class="signal-legend-item buy"><i></i> Buy</span>
        <span class="signal-legend-item passed buy"><i></i> Passed buy</span>
        <span class="signal-legend-item sell"><i></i> Sell</span>
        <span class="signal-legend-item passed sell"><i></i> Passed sell</span>
      </div>
      <div class="signal-chart-body">
        <div class="signal-y-axis" aria-hidden="true">
          ${ticks.map((t) => `<span>${t}</span>`).join("")}
        </div>
        <div class="signal-plot">
          <div class="signal-plot-grid">
            ${ticks.map(() => `<div class="signal-grid-line"></div>`).join("")}
          </div>
          <div class="signal-plot-cols">
            ${groups}
          </div>
        </div>
      </div>
      <div class="signal-x-axis-label">Coin</div>
    </div>
  `;
}

function renderSignalChart(data) {
  const {
    days = [],
    coins = [],
    totals = { buy: 0, sell: 0, passedBuy: 0, passedSell: 0 },
    guidelinePassPercent = 70,
  } = data;

  signalChartSummary.innerHTML = `
    <p><strong>Buy signals:</strong> <span class="signal-total buy">${totals.buy}</span>
      · <strong>Passed (≥${guidelinePassPercent}%):</strong> <span class="signal-total passed buy">${totals.passedBuy || 0}</span></p>
    <p><strong>Sell signals:</strong> <span class="signal-total sell">${totals.sell}</span>
      · <strong>Passed (≥${guidelinePassPercent}%):</strong> <span class="signal-total passed sell">${totals.passedSell || 0}</span></p>
    <p><strong>Range:</strong> ${days[0] || "—"} → ${days[days.length - 1] || "—"}</p>
    <p class="field-hint">Click a chart bar to open each signal with screenshot and Future Trend Pro checklist (same layout as Trade Journal).</p>
  `;

  if (coins.length === 0) {
    signalChartBars.innerHTML = `<p class="empty-state">No coins configured.</p>`;
    signalChartTable.innerHTML = "";
    return;
  }

  signalChartBars.innerHTML = renderSignalColumnChart(coins);
  bindSignalChartBarClicks(Number(signalDaysSelect?.value) || 1);

  const dayHeaders = days.map((d) => `<th>${formatDayLabel(d)}</th>`).join("");

  signalChartTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Coin</th>
          <th>Buy</th>
          <th>Passed buy</th>
          <th>Sell</th>
          <th>Passed sell</th>
          ${dayHeaders}
        </tr>
      </thead>
      <tbody>
        ${coins
          .map((coin) => {
            const dayCells = days
              .map((day) => {
                const cell = coin.days[day] || {
                  buy: 0,
                  sell: 0,
                  passedBuy: 0,
                  passedSell: 0,
                };
                if (
                  cell.buy === 0 &&
                  cell.sell === 0 &&
                  cell.passedBuy === 0 &&
                  cell.passedSell === 0
                ) {
                  return `<td class="signal-cell empty">—</td>`;
                }
                return `<td class="signal-cell">
                  <span class="signal-cell-buy">${cell.buy}</span>
                  <span class="signal-cell-sep">/</span>
                  <span class="signal-cell-passed buy">${cell.passedBuy || 0}</span>
                  <span class="signal-cell-sep">·</span>
                  <span class="signal-cell-sell">${cell.sell}</span>
                  <span class="signal-cell-sep">/</span>
                  <span class="signal-cell-passed sell">${cell.passedSell || 0}</span>
                </td>`;
              })
              .join("");

            return `
              <tr>
                <td><strong>${coin.name}</strong><div class="card-symbol">${coin.id}</div></td>
                <td class="signal-cell-buy"><strong>${coin.totals.buy}</strong></td>
                <td class="signal-cell-passed buy"><strong>${coin.totals.passedBuy || 0}</strong></td>
                <td class="signal-cell-sell"><strong>${coin.totals.sell}</strong></td>
                <td class="signal-cell-passed sell"><strong>${coin.totals.passedSell || 0}</strong></td>
                ${dayCells}
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <p class="field-hint">Signals are saved at capture time. Buy/sell = new chart signal; Passed = signal + Future Trend Pro checklist OK. Day cells: buy / passed · sell / passed.</p>
  `;
}

function tradeStatusLabel(status) {
  if (status === "ok") return "Executed";
  if (status === "skipped") return "Blocked";
  if (status === "error") return "Error";
  return status || "—";
}

function tradeStatusClass(status) {
  if (status === "ok") return "trade-status-ok";
  if (status === "skipped") return "trade-status-blocked";
  if (status === "error") return "trade-status-error";
  return "";
}

function renderChecklistTable(checklist) {
  if (!checklist?.length) {
    return `<p class="empty-state">No checklist data saved for this trade.</p>`;
  }

  return `
    <table class="trade-checklist-table">
      <thead>
        <tr>
          <th>Check</th>
          <th>Required</th>
          <th>Chart shows</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        ${checklist
          .map(
            (item) => `
          <tr class="${item.passed ? "check-pass" : "check-fail"}">
            <td>${item.label}</td>
            <td>${item.required}</td>
            <td>${item.actual || "—"}</td>
            <td class="check-result">${item.passed ? "✓ Pass" : "✗ Fail"}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderTradeActions(actions) {
  if (!actions?.length) return `<p class="field-hint">No Binance orders for this entry.</p>`;
  return `
    <ul class="trade-actions-list">
      ${actions
        .map((a) => {
          if (a.action === "take_profit" || a.action === "stop_loss") {
            return `<li><strong>${a.action}</strong> @ ${a.stopPrice} (${a.percent}%)</li>`;
          }
          const qty = a.quantity != null ? ` qty ${a.quantity}` : "";
          const price = a.price != null ? ` @ ${a.price}` : "";
          return `<li><strong>${a.action}</strong>${qty}${price}</li>`;
        })
        .join("")}
    </ul>
  `;
}

function renderTradeJournalDetail(trade) {
  const analysis = trade.analysis || {};
  const chart = analysis.chartSignal || {};
  const signalLabel = (trade.signal || "—").toUpperCase();

  tradeJournalDetail.innerHTML = `
    <div class="trade-detail-header">
      <button type="button" class="btn btn-secondary btn-sm" id="tradeDetailBackBtn">← Back to list</button>
      <div class="trade-detail-title">
        <h3>${trade.coinName || trade.coinId} · ${signalLabel}</h3>
        <span class="trade-status-badge ${tradeStatusClass(trade.status)}">${tradeStatusLabel(trade.status)}</span>
      </div>
      <p class="field-hint">${formatTime(trade.at)} · ${trade.symbol || ""}</p>
    </div>

    ${renderGuidelineAnalysisBody(trade)}

    <div class="trade-detail-panels">
      <div class="trade-detail-panel">
        <h4>Binance result</h4>
        ${
          trade.status === "error"
            ? `<p class="text-error">${trade.error || "Trade failed"}</p>`
            : trade.status === "skipped"
              ? `<p class="text-muted">${trade.reason || "Trade blocked by guidelines"}</p>`
              : renderTradeActions(trade.actions)
        }
      </div>
    </div>
  `;

  document.getElementById("tradeDetailBackBtn")?.addEventListener("click", () => {
    selectedTradeId = null;
    tradeJournalDetail.classList.add("hidden");
    tradeJournalList.classList.remove("hidden");
    tradeJournalPagination?.classList.remove("hidden");
  });

  bindSignalDetailImages(tradeJournalDetail, trade);
}

function tradeJournalPeriodDays() {
  return Number(pnlDaysSelect?.value) || 30;
}

function tradeJournalSinceMs(days = tradeJournalPeriodDays()) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (days <= 1) return d.getTime();
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

function tradeJournalPeriodLabel(days = tradeJournalPeriodDays()) {
  if (days <= 1) return "today";
  return `last ${days} days`;
}

function filterTradeJournalByPeriod(trades) {
  const sinceMs = tradeJournalSinceMs();
  return trades.filter((t) => t.at && new Date(t.at).getTime() >= sinceMs);
}

function filterTradeJournalTrades(trades) {
  const filter = tradeJournalFilter?.value || "all";
  const passed = trades.filter((t) => t.analysis?.guidelinesPassed === true);
  const inPeriod = filterTradeJournalByPeriod(passed);
  if (filter === "all") return inPeriod;
  return inPeriod.filter((t) => t.status === filter);
}

function tradeJournalEmptyMessage(filter, days = tradeJournalPeriodDays()) {
  const period = days <= 1 ? "for today" : `in the last ${days} days`;
  if (filter === "ok") return `No executed trades with passed guidelines ${period}.`;
  if (filter === "error") return `No errors on passed-guideline signals ${period}.`;
  return days <= 1
    ? "No passed-guideline signals for today."
    : `No passed-guideline signals ${period}.`;
}

function renderTradeJournalPagination({ total, totalPages, perPage, start, filter, days }) {
  if (!tradeJournalPagination) return;

  if (total === 0) {
    tradeJournalPagination.classList.add("hidden");
    tradeJournalPagination.innerHTML = "";
    return;
  }

  const periodLabel = ` · ${tradeJournalPeriodLabel(days)}`;
  const filterLabel = filter === "all" ? "" : ` · ${filter}`;

  if (totalPages <= 1) {
    tradeJournalPagination.innerHTML = `
      <p class="history-page-meta">Showing ${total} entr${total === 1 ? "y" : "ies"}${periodLabel}${filterLabel}</p>
    `;
    tradeJournalPagination.classList.remove("hidden");
    return;
  }

  const end = Math.min(start + perPage, total);
  tradeJournalPagination.innerHTML = `
    <p class="history-page-meta">Showing ${start + 1}–${end} of ${total}${periodLabel}${filterLabel} · ${perPage} per page</p>
    <div class="history-page-controls">
      <button type="button" class="btn btn-secondary btn-sm" data-trade-journal-page="prev" ${tradeJournalPage <= 1 ? "disabled" : ""}>← Prev</button>
      <span class="history-page-label">Page ${tradeJournalPage} of ${totalPages}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-trade-journal-page="next" ${tradeJournalPage >= totalPages ? "disabled" : ""}>Next →</button>
    </div>
  `;

  tradeJournalPagination.querySelectorAll("[data-trade-journal-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tradeJournalPage === "prev" && tradeJournalPage > 1) {
        tradeJournalPage -= 1;
      } else if (btn.dataset.tradeJournalPage === "next" && tradeJournalPage < totalPages) {
        tradeJournalPage += 1;
      }
      renderTradeJournalList(cachedTradeJournal);
      tradeJournalList?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  tradeJournalPagination.classList.remove("hidden");
}

function renderTradeJournalList(trades) {
  const filter = tradeJournalFilter?.value || "all";
  const days = tradeJournalPeriodDays();
  const filtered = filterTradeJournalTrades(trades);
  const perPage = TRADE_JOURNAL_PER_PAGE;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (tradeJournalPage > totalPages) tradeJournalPage = totalPages;
  if (tradeJournalPage < 1) tradeJournalPage = 1;

  const start = (tradeJournalPage - 1) * perPage;
  const pageTrades = filtered.slice(start, start + perPage);

  if (total === 0) {
    tradeJournalList.innerHTML = `<p class="empty-state">${tradeJournalEmptyMessage(filter, days)}</p>`;
    renderTradeJournalPagination({ total: 0, totalPages: 1, perPage, start: 0, filter, days });
    return;
  }

  tradeJournalList.innerHTML = pageTrades
    .map((trade) => {
      const analysis = trade.analysis || {};
      const chart = analysis.chartSignal || {};
      const passed = analysis.guidelinesPassed;
      const checklist = analysis.checklist || [];
      const passStats = analysis.guidelinePassStats || {};
      const passCount = passStats.passed ?? checklist.filter((c) => c.passed && c.key !== "signal").length;
      const totalChecks = passStats.total ?? checklist.filter((c) => c.key !== "signal").length;
      const passPercent = analysis.guidelinePassPercent;
      const thumb = analysis.screenshotUrl || `/screenshots/current/${trade.coinId}.png`;

      return `
        <article class="trade-journal-card" data-trade-id="${trade.id}">
          <div class="trade-journal-thumb">
            <img src="${thumb}?t=${encodeURIComponent(trade.at)}" alt="" loading="lazy" />
          </div>
          <div class="trade-journal-body">
            <div class="trade-journal-top">
              <strong>${trade.coinName || trade.coinId}</strong>
              <span class="signal-badge signal-${trade.signal || "none"}">${(trade.signal || "—").toUpperCase()}</span>
              <span class="trade-status-badge ${tradeStatusClass(trade.status)}">${tradeStatusLabel(trade.status)}</span>
            </div>
            <p class="trade-journal-meta">${formatTime(trade.at)} · ${trade.symbol || ""}</p>
            <p class="trade-journal-signal">
              Chart: <strong>${(chart.signal || "none").toUpperCase()}</strong>
              ${chart.position ? ` · ${chart.position}` : ""}
            </p>
            ${
              totalChecks
                ? `<p class="trade-journal-checks">Guideline checks: <strong>${passCount}/${totalChecks}</strong>${passPercent != null ? ` (${passPercent}%)` : ""} ${passed ? "· passed (≥70%)" : "· below 70%"}</p>`
                : ""
            }
            ${
              trade.status === "skipped"
                ? `<p class="trade-journal-reason">${trade.reason || "Blocked by guidelines"}</p>`
                : trade.status === "error"
                  ? `<p class="trade-journal-reason text-error">${trade.error || "Error"}</p>`
                  : ""
            }
          </div>
          <button type="button" class="btn btn-secondary btn-sm trade-journal-open">Details</button>
        </article>
      `;
    })
    .join("");

  tradeJournalList.querySelectorAll(".trade-journal-card").forEach((card) => {
    const open = () => {
      const id = card.dataset.tradeId;
      const trade = cachedTradeJournal.find((t) => t.id === id);
      if (!trade) return;
      selectedTradeId = id;
      tradeJournalList.classList.add("hidden");
      tradeJournalPagination?.classList.add("hidden");
      tradeJournalDetail.classList.remove("hidden");
      renderTradeJournalDetail(trade);
    };
    card.querySelector(".trade-journal-open")?.addEventListener("click", open);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".trade-journal-open")) return;
      open();
    });
  });

  renderTradeJournalPagination({ total, totalPages, perPage, start, filter, days });
}

function formatUsd(value, { signed = true } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const prefix = signed && n > 0 ? "+" : "";
  return `${prefix}$${n.toFixed(2)}`;
}

function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "pnl-neutral";
  return n > 0 ? "pnl-profit" : "pnl-loss";
}

function renderPnLReport(report) {
  if (!pnlReportSection) return;

  if (!report) {
    pnlReportSection.innerHTML = "";
    return;
  }

  const s = report.summary || {};
  const local = report.local || {};

  if (report.message && !report.connected) {
    pnlReportSection.innerHTML = `
      <div class="pnl-report-wrap">
        <h3 class="pnl-report-title">Profit &amp; Loss Report</h3>
        <p class="field-hint warn-hint">${report.message}</p>
        <div class="pnl-cards">
          <div class="pnl-card">
            <span class="pnl-card-label">Auto-trades executed</span>
            <strong>${local.executed || 0}</strong>
          </div>
          <div class="pnl-card">
            <span class="pnl-card-label">Volume entered</span>
            <strong>${formatUsd(local.totalNotional, { signed: false })}</strong>
          </div>
          <div class="pnl-card">
            <span class="pnl-card-label">Blocked / errors</span>
            <strong>${(local.blocked || 0) + (local.errors || 0)}</strong>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const dayRows = (report.byDay || [])
    .map(
      (d) => `
      <tr>
        <td>${d.date}</td>
        <td class="${pnlClass(d.realizedPnl)}">${formatUsd(d.realizedPnl)}</td>
        <td class="${pnlClass(d.commission)}">${formatUsd(d.commission)}</td>
        <td class="${pnlClass(d.net)}">${formatUsd(d.net)}</td>
        <td>${d.events}</td>
      </tr>
    `
    )
    .join("");

  const symbolRows = (report.bySymbol || [])
    .map(
      (row) => `
      <tr>
        <td><strong>${row.symbol}</strong></td>
        <td class="${pnlClass(row.realizedPnl)}">${formatUsd(row.realizedPnl)}</td>
        <td class="${pnlClass(row.commission)}">${formatUsd(row.commission)}</td>
        <td class="${pnlClass(row.net)}">${formatUsd(row.net)}</td>
        <td>${row.wins}W / ${row.losses}L</td>
      </tr>
    `
    )
    .join("");

  const openRows = (report.openPositions || [])
    .map(
      (p) => `
      <tr>
        <td><strong>${p.symbol}</strong></td>
        <td>${p.side}</td>
        <td>${p.size}</td>
        <td>${formatUsd(p.entryPrice, { signed: false })}</td>
        <td>${formatUsd(p.markPrice, { signed: false })}</td>
        <td class="${pnlClass(p.unrealizedPnl)}">${formatUsd(p.unrealizedPnl)}</td>
      </tr>
    `
    )
    .join("");

  const eventRows = (report.events || [])
    .slice(0, 25)
    .map(
      (e) => `
      <tr>
        <td>${formatTime(e.at)}</td>
        <td>${e.symbol}</td>
        <td class="${pnlClass(e.amount)}">${formatUsd(e.amount)}</td>
      </tr>
    `
    )
    .join("");

  pnlReportSection.innerHTML = `
    <div class="pnl-report-wrap">
      <h3 class="pnl-report-title">Profit &amp; Loss Report <span class="pnl-period">last ${report.days} days${report.testnet ? " · testnet" : ""}</span></h3>
      ${report.error ? `<p class="field-hint warn-hint">${report.error}</p>` : ""}

      <div class="pnl-cards">
        <div class="pnl-card pnl-card-main ${pnlClass(s.netPnl)}">
          <span class="pnl-card-label">Net P&amp;L</span>
          <strong>${formatUsd(s.netPnl)}</strong>
          <span class="pnl-card-sub">Realized + fees</span>
        </div>
        <div class="pnl-card ${pnlClass(s.realizedPnl)}">
          <span class="pnl-card-label">Realized P&amp;L</span>
          <strong>${formatUsd(s.realizedPnl)}</strong>
        </div>
        <div class="pnl-card ${pnlClass(s.unrealizedPnl)}">
          <span class="pnl-card-label">Unrealized P&amp;L</span>
          <strong>${formatUsd(s.unrealizedPnl)}</strong>
          <span class="pnl-card-sub">${s.openPositions || 0} open</span>
        </div>
        <div class="pnl-card">
          <span class="pnl-card-label">Wallet balance</span>
          <strong>${s.walletBalance != null ? formatUsd(s.walletBalance, { signed: false }) : "—"}</strong>
        </div>
        <div class="pnl-card">
          <span class="pnl-card-label">Win rate</span>
          <strong>${s.winRate != null ? `${s.winRate}%` : "—"}</strong>
          <span class="pnl-card-sub">${s.wins || 0}W / ${s.losses || 0}L</span>
        </div>
        <div class="pnl-card">
          <span class="pnl-card-label">Auto-trades</span>
          <strong>${local.executed || 0}</strong>
          <span class="pnl-card-sub">${local.blocked || 0} blocked</span>
        </div>
      </div>

      <div class="pnl-tables-grid">
        <div class="pnl-table-panel">
          <h4>Daily P&amp;L</h4>
          ${
            dayRows
              ? `<table class="pnl-table"><thead><tr><th>Date</th><th>Realized</th><th>Fees</th><th>Net</th><th>Events</th></tr></thead><tbody>${dayRows}</tbody></table>`
              : `<p class="empty-state">No closed P&amp;L in this period.</p>`
          }
        </div>
        <div class="pnl-table-panel">
          <h4>By symbol</h4>
          ${
            symbolRows
              ? `<table class="pnl-table"><thead><tr><th>Symbol</th><th>Realized</th><th>Fees</th><th>Net</th><th>W/L</th></tr></thead><tbody>${symbolRows}</tbody></table>`
              : `<p class="empty-state">No symbol breakdown yet.</p>`
          }
        </div>
      </div>

      ${
        openRows
          ? `<div class="pnl-table-panel"><h4>Open positions</h4><table class="pnl-table"><thead><tr><th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Unrealized</th></tr></thead><tbody>${openRows}</tbody></table></div>`
          : ""
      }

      ${
        eventRows
          ? `<div class="pnl-table-panel"><h4>Recent realized P&amp;L events</h4><table class="pnl-table"><thead><tr><th>Time</th><th>Symbol</th><th>P&amp;L</th></tr></thead><tbody>${eventRows}</tbody></table></div>`
          : ""
      }
    </div>
  `;
}

function renderTradeJournalSummary(trades) {
  const executed = trades.filter((t) => t.status === "ok").length;
  const errors = trades.filter((t) => t.status === "error").length;

  tradeJournalSummary.innerHTML = `
    <p><strong>${trades.length}</strong> passed signals · <span class="trade-status-ok">${executed} executed</span> · <span class="trade-status-error">${errors} errors</span></p>
    <p class="field-hint">Only signals with <strong>≥70%</strong> guideline checklist are shown. Blocked (below 70%) entries are excluded.</p>
  `;
}

async function loadTradeJournal() {
  if (!tradeJournalList) return;

  tradeJournalSummary.innerHTML = `<p>Loading trade journal…</p>`;
  if (pnlReportSection) pnlReportSection.innerHTML = `<p class="field-hint">Loading P&amp;L…</p>`;
  tradeJournalList.innerHTML = "";
  tradeJournalDetail.classList.add("hidden");
  tradeJournalList.classList.remove("hidden");
  tradeJournalPagination?.classList.add("hidden");

  const days = tradeJournalPeriodDays();

  try {
    const [tradesRes, pnlRes] = await Promise.all([
      fetch("/api/trades?limit=500"),
      fetch(`/api/pnl-report?days=${encodeURIComponent(days)}`),
    ]);
    const tradesData = await parseJsonResponse(tradesRes);
    const pnlData = await parseJsonResponse(pnlRes);
    if (!tradesRes.ok) throw new Error(tradesData.error);
    if (!pnlRes.ok) throw new Error(pnlData.error);

    cachedTradeJournal = tradesData.trades || [];
    cachedPnLReport = pnlData.report || null;
    tradeJournalPage = 1;
    renderPnLReport(cachedPnLReport);
    renderTradeJournalSummary(cachedTradeJournal);
    renderTradeJournalList(cachedTradeJournal);

    if (selectedTradeId) {
      const trade = cachedTradeJournal.find((t) => t.id === selectedTradeId);
      if (trade) {
        tradeJournalList.classList.add("hidden");
        tradeJournalPagination?.classList.add("hidden");
        tradeJournalDetail.classList.remove("hidden");
        renderTradeJournalDetail(trade);
      }
    }
  } catch (err) {
    tradeJournalSummary.innerHTML = `<p class="text-error">${err.message || "Failed to load trade journal."}</p>`;
    if (pnlReportSection) pnlReportSection.innerHTML = "";
    tradeJournalList.innerHTML = "";
  }
}

function outcomeLabel(outcome, exitStep) {
  if (outcome === "win_tp") {
    return exitStep ? `Win · TP @ +${exitStep} SS` : "Win (TP)";
  }
  if (outcome === "loss_sl") {
    return exitStep ? `Loss · SL @ +${exitStep} SS` : "Loss (SL)";
  }
  if (outcome === "after_3") return "Open after 3 SS";
  return outcome || "—";
}

function outcomeClass(outcome) {
  if (outcome === "win_tp") return "pnl-profit";
  if (outcome === "loss_sl") return "pnl-loss";
  return "pnl-neutral";
}

function renderLocalAnalyzeSummary(data) {
  if (!localAnalyzeSummary || !data) return;

  const t = data.totals || {};
  const today = data.todayTotals || {};
  const s = data.settings || {};

  localAnalyzeSummary.innerHTML = `
    <div class="local-summary-cards">
      <div class="pnl-card pnl-card-main ${pnlClass(t.totalPnl)}">
        <span class="pnl-card-label">Total simulated P&amp;L</span>
        <strong>${formatUsd(t.totalPnl)}</strong>
        <span class="pnl-card-sub">${t.simulated || 0} paper trades</span>
      </div>
      <div class="pnl-card ${pnlClass(today.totalPnl)}">
        <span class="pnl-card-label">Today simulated P&amp;L</span>
        <strong>${formatUsd(today.totalPnl)}</strong>
        <span class="pnl-card-sub">${today.simulated || 0} paper trades${today.winRate != null ? ` · ${today.winRate}% win` : ""} · ${today.wins || 0}W / ${today.losses || 0}L / ${today.openAfter3 || 0} flat</span>
      </div>
      <div class="pnl-card">
        <span class="pnl-card-label">Win rate</span>
        <strong>${t.winRate != null ? `${t.winRate}%` : "—"}</strong>
        <span class="pnl-card-sub">${t.wins || 0}W / ${t.losses || 0}L / ${t.openAfter3 || 0} flat</span>
      </div>
      <div class="pnl-card">
        <span class="pnl-card-label">Passed signals</span>
        <strong>${t.signalsDetected || 0}</strong>
        <span class="pnl-card-sub">≥70% checklist only</span>
      </div>
      <div class="pnl-card">
        <span class="pnl-card-label">SS sets used</span>
        <strong>${data.setsUsed || 0}</strong>
        <span class="pnl-card-sub">${data.setsUsed || 0} screenshot sets · ${data.forwardCaptures || 3} forward</span>
      </div>
    </div>
    <p class="field-hint">
      Uses <strong>passed signals only</strong> (≥70% Future Trend Pro checklist on entry screenshot).
      Each BUY/SELL counted once per <strong>${s.holdCandles || 2}</strong>-candle hold window (same as live auto-trade).
      Simulates <strong>${s.tradeAmountUsdt || 2} USDT</strong> × <strong>${s.tradeLeverage || 10}x</strong>
      · TP <strong>${s.tradeTpPercent || 30}%</strong> · SL <strong>${s.tradeSlPercent || 30}%</strong>
      · Mode <strong>${s.tradeMode || "long_only"}</strong>
      · Outcome checked on +1, +2, +3 screenshots — stops as soon as TP or SL is hit.
    </p>
  `;
}

function localAnalyzeTableRows(perCoin) {
  if (perCoin?.length) return perCoin;
  return cachedCoins.map((c) => ({
    coinId: c.id,
    coinName: c.name,
    counts: null,
  }));
}

function renderLocalAnalyzeCoinTable(perCoin, activeCoinId = null, { loading = false } = {}) {
  if (!localAnalyzeCoinTable) return;

  const rows = localAnalyzeTableRows(perCoin);
  const tableClass = loading ? "local-analyze-table-loading" : "";

  if (!rows.length) {
    localAnalyzeCoinTable.innerHTML = `
      <table class="${tableClass}">
        <thead>
          <tr>
            <th>Coin</th>
            <th>Passed</th>
            <th>Trades</th>
            <th>W / L / Open</th>
            <th>Win %</th>
            <th>Sim P&amp;L</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="7" class="empty-state">${loading ? "Loading today's analysis…" : "No coins configured."}</td></tr>
        </tbody>
      </table>
    `;
    return;
  }

  localAnalyzeCoinTable.innerHTML = `
    <table class="${tableClass}">
      <thead>
        <tr>
          <th>Coin</th>
          <th>Passed</th>
          <th>Trades</th>
          <th>W / L / Open</th>
          <th>Win %</th>
          <th>Sim P&amp;L</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const c = row.counts;
            const pending = loading;
            const isActive = activeCoinId === row.coinId;
            const hasTrades = !pending && (c?.simulated || 0) > 0;
            return `
            <tr class="${isActive ? "local-analyze-row-active" : ""}${pending ? " local-analyze-row-pending" : ""}">
              <td><strong>${row.coinName}</strong><div class="card-symbol">${row.coinId}</div></td>
              <td>${pending ? "…" : c?.signalsDetected || 0}</td>
              <td>${pending ? "…" : c?.simulated || 0}</td>
              <td>${pending ? "…" : `${c?.wins || 0} / ${c?.losses || 0} / ${c?.openAfter3 || 0}`}</td>
              <td>${pending ? "…" : c?.winRate != null ? `${c.winRate}%` : "—"}</td>
              <td class="${pending ? "" : pnlClass(c?.totalPnl)}">${pending ? "…" : formatUsd(c?.totalPnl)}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm local-analyze-view-btn"
                  data-coin-id="${row.coinId}"
                  ${hasTrades ? "" : "disabled"}
                >View Report</button>
              </td>
            </tr>
          `;
          })
          .join("")}
      </tbody>
    </table>
  `;

  localAnalyzeCoinTable.querySelectorAll(".local-analyze-view-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      viewLocalAnalyzeCoinReport(btn.dataset.coinId);
    });
  });
}

function renderLocalAnalyzeListHeader(coinRow) {
  if (!localAnalyzeListHeader) return;

  if (!coinRow) {
    localAnalyzeListHeader.classList.add("hidden");
    localAnalyzeListHeader.innerHTML = "";
    return;
  }

  const c = coinRow.counts || {};
  localAnalyzeListHeader.classList.remove("hidden");
  localAnalyzeListHeader.innerHTML = `
    <div class="local-analyze-list-header-inner">
      <div>
        <h3>${coinRow.coinName} <span class="card-symbol">${coinRow.coinId}</span></h3>
        <p class="field-hint">${c.simulated || 0} paper trade(s) · ${formatUsd(c.totalPnl)} sim P&amp;L · ${c.wins || 0}W / ${c.losses || 0}L / ${c.openAfter3 || 0} open</p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="localAnalyzeShowAllBtn">Show all coins</button>
    </div>
  `;

  document.getElementById("localAnalyzeShowAllBtn")?.addEventListener("click", () => {
    selectedLocalAnalyzeCoinId = null;
    selectedLocalSimId = null;
    renderLocalAnalyzeCoinTable(cachedLocalAnalysis?.perCoin, null);
    renderLocalAnalyzeListHeader(null);
    renderLocalAnalyzeList(cachedLocalAnalysis?.simulations || []);
    localAnalyzeDetail.classList.add("hidden");
    localAnalyzeList.classList.remove("hidden");
  });
}

function viewLocalAnalyzeCoinReport(coinId) {
  if (!cachedLocalAnalysis || !coinId) return;

  const coinRow = cachedLocalAnalysis.perCoin?.find((r) => r.coinId === coinId);
  const simulations =
    cachedLocalAnalysis.simulations?.filter((s) => s.coinId === coinId) || [];

  selectedLocalAnalyzeCoinId = coinId;
  selectedLocalSimId = null;

  renderLocalAnalyzeCoinTable(cachedLocalAnalysis.perCoin, coinId);
  renderLocalAnalyzeListHeader(coinRow);
  renderLocalAnalyzeList(simulations);

  localAnalyzeDetail.classList.add("hidden");
  localAnalyzeList.classList.remove("hidden");

  localAnalyzeListHeader?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLocalAnalyzeDetail(sim) {
  if (!localAnalyzeDetail || !sim) return;

  const simResult = sim.simulation || {};
  const analysis = sim.analysis || {};
  const checklist = analysis.checklist || [];

  localAnalyzeDetail.innerHTML = `
    <div class="trade-detail-header">
      <button type="button" class="btn btn-secondary btn-sm" id="localDetailBackBtn">← Back to list</button>
      <div class="trade-detail-title">
        <h3>${sim.coinName} · ${(sim.signal || "").toUpperCase()}</h3>
        <span class="trade-status-badge ${outcomeClass(simResult.outcome)}">${outcomeLabel(simResult.outcome, simResult.exitStep)}</span>
        <span class="${pnlClass(simResult.pnlUsdt)}">${formatUsd(simResult.pnlUsdt)}</span>
      </div>
      <p class="field-hint">Entry ${formatTime(sim.entrySet.at)} @ ${simResult.entryPrice} → exit @ ${simResult.exitPrice} (SS +${simResult.exitStep || "?"})</p>
    </div>

    <div class="local-forward-grid">
      <div class="local-ss-card">
        <h4>Entry screenshot</h4>
        <img src="${sim.entrySet.screenshotUrl}?t=${encodeURIComponent(sim.entrySet.at)}" alt="Entry" />
        <p>Price: <strong>${sim.entrySet.price}</strong></p>
      </div>
      ${(sim.forwardSets || [])
        .map(
          (fs, idx) => `
        <div class="local-ss-card">
          <h4>+${idx + 1} SS</h4>
          <img src="${fs.screenshotUrl}?t=${encodeURIComponent(fs.at)}" alt="Forward ${idx + 1}" />
          <p>Price: <strong>${fs.price ?? "—"}</strong>
          ${simResult.steps?.[idx] ? ` · <span class="${outcomeClass(simResult.steps[idx].status === "tp" ? "win_tp" : simResult.steps[idx].status === "sl" ? "loss_sl" : "")}">${simResult.steps[idx].status === "tp" ? "TP hit" : simResult.steps[idx].status === "sl" ? "SL hit" : simResult.steps[idx].status}</span>` : ""}
          </p>
        </div>
      `
        )
        .join("")}
    </div>

    <div class="trade-detail-panels">
      <div class="trade-detail-panel">
        <h4>Simulated trade</h4>
        <ul class="trade-meta-list">
          <li>Entry: <strong>${simResult.entryPrice}</strong></li>
          <li>TP target: <strong>${simResult.tpPrice}</strong></li>
          <li>SL target: <strong>${simResult.slPrice}</strong></li>
          <li>Exit: <strong>${simResult.exitPrice}</strong> (${outcomeLabel(simResult.outcome, simResult.exitStep)})</li>
          <li>P&amp;L: <strong class="${pnlClass(simResult.pnlUsdt)}">${formatUsd(simResult.pnlUsdt)}</strong> (${simResult.pnlPercent}%)</li>
          <li>Size: <strong>${simResult.usdt} USDT × ${simResult.leverage}x</strong></li>
        </ul>
      </div>
      <div class="trade-detail-panel">
        <h4>Guidelines</h4>
        <p class="field-hint">${analysis.guidelinePassPercent != null ? `${analysis.guidelinePassPercent}% checklist complete` : "Checklist"} · need ≥70% to pass</p>
        ${renderChecklistTable(checklist)}
      </div>
    </div>
  `;

  document.getElementById("localDetailBackBtn")?.addEventListener("click", () => {
    selectedLocalSimId = null;
    localAnalyzeDetail.classList.add("hidden");
    localAnalyzeList.classList.remove("hidden");
    if (selectedLocalAnalyzeCoinId && cachedLocalAnalysis) {
      const simulations = cachedLocalAnalysis.simulations.filter(
        (s) => s.coinId === selectedLocalAnalyzeCoinId
      );
      renderLocalAnalyzeList(simulations);
    }
  });

  localAnalyzeDetail.querySelectorAll("img").forEach((img) => {
    img.addEventListener("click", () => {
      openLightbox(img.src, `${sim.coinName} · ${sim.signal}`);
    });
  });
}

function renderLocalAnalyzeList(simulations) {
  if (!localAnalyzeList) return;

  if (!simulations?.length) {
    localAnalyzeList.innerHTML = `<p class="empty-state">No simulated trades — need a signal with up to 3 screenshots after it (stops early on TP/SL).</p>`;
    return;
  }

  localAnalyzeList.innerHTML = simulations
    .map((sim) => {
      const r = sim.simulation || {};
      return `
        <article class="local-analyze-card" data-sim-id="${sim.id}">
          <div class="trade-journal-thumb">
            <img src="${sim.entrySet.screenshotUrl}?t=${encodeURIComponent(sim.entrySet.at)}" alt="" loading="lazy" />
          </div>
          <div class="trade-journal-body">
            <div class="trade-journal-top">
              <strong>${sim.coinName}</strong>
              <span class="signal-badge signal-${sim.signal}">${(sim.signal || "").toUpperCase()}</span>
              <span class="trade-status-badge ${outcomeClass(r.outcome)}">${outcomeLabel(r.outcome, r.exitStep)}</span>
              <span class="${pnlClass(r.pnlUsdt)}">${formatUsd(r.pnlUsdt)}</span>
            </div>
            <p class="trade-journal-meta">${formatTime(sim.entrySet.at)} · entry ${r.entryPrice} → ${r.exitPrice}</p>
            <p class="trade-journal-signal">TP ${r.tpPrice} · SL ${r.slPrice}${r.exitStep ? ` · closed @ +${r.exitStep} SS` : ""}</p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm">Details</button>
        </article>
      `;
    })
    .join("");

  localAnalyzeList.querySelectorAll(".local-analyze-card").forEach((card) => {
    const open = () => {
      const id = card.dataset.simId;
      const sim = simulations.find((s) => s.id === id);
      if (!sim) return;
      selectedLocalSimId = id;
      localAnalyzeList.classList.add("hidden");
      localAnalyzeDetail.classList.remove("hidden");
      renderLocalAnalyzeDetail(sim);
    };
    card.querySelector("button")?.addEventListener("click", (e) => {
      e.stopPropagation();
      open();
    });
    card.addEventListener("click", open);
  });
}

async function runLocalAnalyze() {
  if (!localAnalyzeSummary) return;

  const days = Number(localAnalyzeDays?.value) || 1;

  const rangeLabel = days === 1 ? "today" : `last ${days} days`;
  localAnalyzeStatus.textContent = `Analyzing ${rangeLabel}'s screenshots… this may take a minute.`;
  renderLocalAnalyzeCoinTable(null, selectedLocalAnalyzeCoinId, { loading: true });
  if (selectedLocalAnalyzeCoinId) {
    renderLocalAnalyzeListHeader(null);
    localAnalyzeList.innerHTML = `<p class="field-hint local-analyze-prompt">Reloading paper trades…</p>`;
  }
  runLocalAnalyzeBtn.disabled = true;

  try {
    const res = await fetch(`/api/local-trade-analysis?days=${days}`);
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    cachedLocalAnalysis = data.analysis;
    cachedLocalAnalyzeKey = String(days);
    selectedLocalSimId = null;
    localAnalyzeDetail.classList.add("hidden");
    localAnalyzeList.classList.remove("hidden");
    renderLocalAnalyzeFromCache();
  } catch (err) {
    localAnalyzeStatus.innerHTML = `<span class="text-error">${err.message || "Analysis failed."}</span>`;
  } finally {
    runLocalAnalyzeBtn.disabled = false;
  }
}

function renderLocalAnalyzeFromCache() {
  if (!cachedLocalAnalysis) return;

  localAnalyzeStatus.textContent = `Done · ${cachedLocalAnalysis.simulations?.length || 0} simulated trades from ${cachedLocalAnalysis.setsUsed} screenshot sets.`;
  renderLocalAnalyzeSummary(cachedLocalAnalysis);
  renderLocalAnalyzeCoinTable(cachedLocalAnalysis.perCoin, selectedLocalAnalyzeCoinId);

  if (selectedLocalSimId) {
    const sim = cachedLocalAnalysis.simulations?.find((s) => s.id === selectedLocalSimId);
    if (sim) {
      localAnalyzeList.classList.add("hidden");
      localAnalyzeDetail.classList.remove("hidden");
      renderLocalAnalyzeDetail(sim);
      return;
    }
    selectedLocalSimId = null;
  }

  if (selectedLocalAnalyzeCoinId) {
    viewLocalAnalyzeCoinReport(selectedLocalAnalyzeCoinId);
  } else {
    renderLocalAnalyzeListHeader(null);
    localAnalyzeList.innerHTML = `<p class="field-hint local-analyze-prompt">Click <strong>View Report</strong> on a coin in the table above to see its paper trades below.</p>`;
  }
}

function localAnalyzeParamsKey() {
  return String(Number(localAnalyzeDays?.value) || 1);
}

async function loadLocalAnalyze(options = {}) {
  const forceToday = options.forceToday === true;
  const force = options.force === true || forceToday;

  if (forceToday && localAnalyzeDays) {
    localAnalyzeDays.value = "1";
  }

  const key = localAnalyzeParamsKey();

  if (!force && cachedLocalAnalysis && cachedLocalAnalyzeKey === key) {
    renderLocalAnalyzeFromCache();
    return;
  }

  renderLocalAnalyzeCoinTable(null, selectedLocalAnalyzeCoinId, { loading: true });
  localAnalyzeStatus.textContent = forceToday
    ? "Loading today's paper trade table…"
    : "Loading paper trade table…";

  await runLocalAnalyze();
}

function renderCompareView() {
  const selected = cachedCoins.filter((c) => compareSelection.has(c.id));

  if (selected.length < 2) {
    compareGrid.innerHTML = `<p class="empty-state">Select 2–4 coins using the ⇔ button on the Dashboard.</p>`;
    return;
  }

  const cacheBust = lastRenderedAt || Date.now();
  compareGrid.innerHTML = selected
    .map((coin) => {
      const src = `${coin.imageUrl}?t=${encodeURIComponent(cacheBust)}`;
      return `
        <article class="compare-card">
          <div class="compare-card-header">
            <strong>${coin.name}${renderTitleAnalyzeStatus(coin, { signalAnalysis: null, chartSignal: coin.chartSignal })}</strong>
            <div class="card-meta-row">
              <span class="card-symbol">${coin.symbol}</span>
              ${renderAlertBadges(coin.alert)}
            </div>
          </div>
          <div class="compare-card-image ${signalHighlightClass(coin.chartSignal)}">
            <img class="ss-thumb" src="${src}" data-full-src="${src}" data-caption="${coin.name} (${coin.symbol})" alt="${coin.name}" />
          </div>
        </article>
      `;
    })
    .join("");

  attachScreenshotHandlers(compareGrid);
}

async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.ok
        ? "Invalid response from server — try restarting the app."
        : `Server error (${res.status}) — restart the app if this keeps happening.`
    );
  }
}

async function fetchDashboard() {
  const res = await fetch("/api/coins");
  return res.json();
}

async function fetchStatus() {
  const res = await fetch("/api/status");
  return res.json();
}

function updateAutoRefreshUI(enabled, intervalMs) {
  autoRefreshBtn.textContent = enabled ? "Stop Auto-refresh" : "Start Auto-refresh";
  autoRefreshBtn.classList.toggle("btn-danger", enabled);
  autoRefreshBtn.classList.toggle("btn-secondary", !enabled);

  const minutes = Math.round(intervalMs / 60000);
  autoRefreshEl.textContent = enabled
    ? `Auto-refresh: every ${minutes} minutes (running)`
    : `Auto-refresh: stopped`;
}

function updateStatusUI(state, settings) {
  if (state.signalAnalysis?.running) {
    setBadge("Analyzing charts...", "running");
    refreshBtn.disabled = true;
    refreshGroupBtn.disabled = true;
  } else if (state.running) {
    setBadge("Capturing...", "running");
    refreshBtn.disabled = true;
    refreshGroupBtn.disabled = true;
  } else {
    stopDurationTicker();
    if (state.error) {
      setBadge("Error", "error");
    } else {
      setBadge("Ready", "ready");
    }
    refreshBtn.disabled = false;
    refreshGroupBtn.disabled = activeGroup === "all";
  }

  lastRunEl.textContent = `Last update: ${formatTime(state.lastRun?.at)} (${state.lastRun?.trigger || "—"})`;
  if (settings) applySettings(settings);
}

function renderDashboardGrid(coins, state, captureAt) {
  const resultMap = Object.fromEntries(
    (state.lastResults || []).map((r) => [r.coin, r])
  );

  renderCoinGrid(dashboardGrid, filterCoinsForView(coins), {
    resultMap,
    cacheBust: captureAt || "",
    running: state.running,
    progress: state.progress,
    signalAnalysis: state.signalAnalysis,
  });
}

async function loadDashboardImages(captureAt, state, coins) {
  if (!coins) {
    const data = await fetchDashboard();
    cachedCoins = data.coins;
    cachedGroups = data.groups || cachedGroups;
    coins = data.coins;
    state = state || data.state;
  }

  renderDashboardGrid(coins, state || { running: false, lastResults: [] }, captureAt);
  lastRenderedAt = captureAt || lastRenderedAt;

  if (currentView === "compare") {
    renderCompareView();
  }
}

async function refreshDashboard({ forceImages = false, reRender = false } = {}) {
  try {
    const data = await fetchDashboard();
    cachedCoins = data.coins;
    cachedGroups = data.groups || cachedGroups;
    renderGroupFilters();
    updateStatusUI(data.state, data.settings);

    const captureAt = data.state.lastRun?.at;
    const progressK = progressKey(data.state.progress);

    if (data.state.running || data.state.signalAnalysis?.running) {
      if (
        progressK !== lastProgressKey ||
        signalAnalysisKey(data.state.signalAnalysis) !== lastSignalAnalysisKey ||
        forceImages ||
        reRender
      ) {
        lastProgressKey = progressK;
        lastSignalAnalysisKey = signalAnalysisKey(data.state.signalAnalysis);
        renderDashboardGrid(data.coins, data.state, captureAt);
      }
      return;
    }

    lastProgressKey = "";
    if (
      forceImages ||
      reRender ||
      (captureAt && captureAt !== lastRenderedAt) ||
      dashboardGrid.children.length === 0
    ) {
      await loadDashboardImages(captureAt, data.state, data.coins);
    } else if (currentView === "compare") {
      renderCompareView();
    }
  } catch {
    setBadge("Offline", "error");
  }
}

async function pollCaptureStatus() {
  if (currentView !== "dashboard" && currentView !== "compare") return;

  try {
    const data = await fetchStatus();
    const captureAt = data.lastRun?.at;
    const wasRendering = lastRenderedAt;
    const progressK = progressKey(data.progress);
    const signalK = signalAnalysisKey(data.signalAnalysis);

    updateStatusUI(
      {
        running: data.running,
        lastRun: data.lastRun,
        error: data.error,
        signalAnalysis: data.signalAnalysis,
      },
      data.settings
    );

    const stateChanged =
      progressK !== lastProgressKey || signalK !== lastSignalAnalysisKey;

    if (data.running || data.signalAnalysis?.running) {
      if (stateChanged) {
        lastProgressKey = progressK;
        lastSignalAnalysisKey = signalK;
        const dash = await fetchDashboard();
        cachedCoins = dash.coins;
        renderDashboardGrid(
          dash.coins,
          { ...data, lastResults: dash.state?.lastResults || data.lastResults },
          captureAt
        );
      } else if (data.running && data.progress) {
        liveCaptureProgress = data.progress;
        updateDurationLabels();
      }
      return;
    }

    stopDurationTicker();

    lastProgressKey = "";
    lastSignalAnalysisKey = "";

    lastProgressKey = "";
    if (captureAt && captureAt !== wasRendering) {
      await loadDashboardImages(captureAt, data);
      if (currentView === "compare") renderCompareView();
      stopStatusPoll();
    } else if (!captureAt) {
      stopStatusPoll();
    }
  } catch {
    setBadge("Offline", "error");
    stopStatusPoll();
  }
}

function startStatusPoll() {
  if (statusPollTimer) return;
  statusPollTimer = setInterval(pollCaptureStatus, 1000);
}

function stopStatusPoll() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function startAutoWatch() {
  if (autoWatchTimer) return;
  autoWatchTimer = setInterval(async () => {
    if (currentView !== "dashboard" || statusPollTimer) return;

    try {
      const data = await fetchStatus();
      const captureAt = data.lastRun?.at;

      if (data.running || data.signalAnalysis?.running) {
        startStatusPoll();
        await pollCaptureStatus();
        return;
      }

      if (captureAt && captureAt !== lastRenderedAt) {
        updateStatusUI(
          { running: false, lastRun: data.lastRun, error: data.error },
          data.settings
        );
        await loadDashboardImages(captureAt, data);
      }
    } catch {
      // Background watch is best-effort.
    }
  }, 15000);
}

async function loadHistoryList({ resetPage = false } = {}) {
  historyList.classList.remove("hidden");
  historyPagination.classList.remove("hidden");
  historyDetail.classList.add("hidden");
  historyBackBtn.classList.add("hidden");

  if (resetPage) {
    historyPage = 1;
  }

  try {
    if (cachedHistorySets.length === 0) {
      const res = await fetch("/api/history");
      const { sets } = await res.json();
      cachedHistorySets = sets;
    }

    if (cachedHistorySets.length === 0) {
      historyList.innerHTML = `<p class="empty-state">No screenshot sets yet. Run a capture from the Dashboard.</p>`;
      historyPagination.classList.add("hidden");
      return;
    }

    renderHistoryPage();
  } catch {
    historyList.innerHTML = `<p class="empty-state text-error">Failed to load history.</p>`;
    historyPagination.classList.add("hidden");
  }
}

function renderHistoryPage() {
  const perPage = currentSettings.historyPerPage || 10;
  const total = cachedHistorySets.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (historyPage > totalPages) {
    historyPage = totalPages;
  }
  if (historyPage < 1) {
    historyPage = 1;
  }

  const start = (historyPage - 1) * perPage;
  const pageSets = cachedHistorySets.slice(start, start + perPage);

  historyList.innerHTML = pageSets
    .map(
      (set) => `
        <button class="history-item" data-set-id="${set.id}">
          <div class="history-item-main">
            <strong>${formatTime(set.at)}</strong>
            <span class="history-trigger">${set.trigger}</span>
          </div>
          <div class="history-item-meta">
            ${set.successCount}/${set.coinCount} captured · ${set.images.length} images saved
          </div>
        </button>
      `
    )
    .join("");

  historyList.querySelectorAll(".history-item").forEach((btn) => {
    btn.addEventListener("click", () => openHistorySet(btn.dataset.setId));
  });

  renderHistoryPagination({ total, totalPages, perPage, start });
}

function renderHistoryPagination({ total, totalPages, perPage, start }) {
  if (totalPages <= 1) {
    historyPagination.innerHTML = `
      <p class="history-page-meta">Showing ${total} set${total === 1 ? "" : "s"} · ${perPage} per page</p>
    `;
    historyPagination.classList.remove("hidden");
    return;
  }

  const end = Math.min(start + perPage, total);
  historyPagination.innerHTML = `
    <p class="history-page-meta">Showing ${start + 1}–${end} of ${total} · ${perPage} per page</p>
    <div class="history-page-controls">
      <button type="button" class="btn btn-secondary btn-sm" data-history-page="prev" ${historyPage <= 1 ? "disabled" : ""}>← Prev</button>
      <span class="history-page-label">Page ${historyPage} of ${totalPages}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-history-page="next" ${historyPage >= totalPages ? "disabled" : ""}>Next →</button>
    </div>
  `;

  historyPagination.querySelectorAll("[data-history-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.historyPage === "prev" && historyPage > 1) {
        historyPage -= 1;
        renderHistoryPage();
      } else if (btn.dataset.historyPage === "next" && historyPage < totalPages) {
        historyPage += 1;
        renderHistoryPage();
      }
    });
  });

  historyPagination.classList.remove("hidden");
}

async function refreshHistoryList() {
  cachedHistorySets = [];
  await loadHistoryList();
}

async function openHistorySet(setId) {
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(setId)}`);
    const { set } = await res.json();

    historyList.classList.add("hidden");
    historyPagination.classList.add("hidden");
    historyDetail.classList.remove("hidden");
    historyBackBtn.classList.remove("hidden");

    historyMeta.innerHTML = `
      <p><strong>Captured:</strong> ${formatTime(set.at)}</p>
      <p><strong>Trigger:</strong> ${set.trigger}</p>
      <p><strong>Success:</strong> ${set.successCount}/${set.coinCount}</p>
    `;

    const imageMap = Object.fromEntries(
      set.images.map((img) => [img.coinId, img.url])
    );
    const resultMap = Object.fromEntries(
      (set.results || []).map((r) => [r.coin, r])
    );

    const coins = set.coins.map((c) => ({
      ...c,
      imageUrl: imageMap[c.id],
    }));

    renderCoinGrid(historyGrid, coins, { resultMap, cacheBust: set.id, showActions: false });
  } catch {
    historyMeta.innerHTML = `<p class="text-error">Failed to load screenshot set.</p>`;
  }
}

async function loadCoinsTable() {
  try {
    const data = await fetchDashboard();
    cachedCoins = data.coins;
    cachedGroups = data.groups || cachedGroups;

    if (data.coins.length === 0) {
      coinsTable.innerHTML = `<p class="empty-state">No coins yet. Add one above.</p>`;
      return;
    }

    const groupOptions = (id) =>
      cachedGroups
        .map(
          (g) =>
            `<option value="${g.id}" ${coinGroupSelected(id, g.id)}>${g.label}</option>`
        )
        .join("");

    function coinGroupSelected(coinId, groupId) {
      const coin = data.coins.find((c) => c.id === coinId);
      return coin?.group === groupId ? "selected" : "";
    }

    coinsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Pin</th>
            <th>Name</th>
            <th>Symbol</th>
            <th>Group</th>
            <th>ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${data.coins
            .map(
              (coin) => `
            <tr data-coin-row="${coin.id}">
              <td>
                <button type="button" class="btn-pin table-pin ${coin.pinned ? "active" : ""}" data-table-pin="${coin.id}" title="Pin">★</button>
              </td>
              <td>${coin.name}</td>
              <td><code>${coin.symbol}</code></td>
              <td>
                <select class="coin-group-select" data-coin-group="${coin.id}">
                  ${groupOptions(coin.id)}
                </select>
              </td>
              <td><code>${coin.id}</code></td>
              <td>
                <button class="btn btn-danger btn-sm" data-remove="${coin.id}">Remove</button>
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;

    coinsTable.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeCoin(btn.dataset.remove));
    });

    coinsTable.querySelectorAll("[data-table-pin]").forEach((btn) => {
      btn.addEventListener("click", () => togglePin(btn.dataset.tablePin));
    });

    coinsTable.querySelectorAll("[data-coin-group]").forEach((select) => {
      select.addEventListener("change", () =>
        updateCoinGroup(select.dataset.coinGroup, select.value)
      );
    });
  } catch {
    coinsTable.innerHTML = `<p class="empty-state text-error">Failed to load coins.</p>`;
  }
}

async function updateCoinGroup(coinId, group) {
  try {
    const res = await fetch(`/api/coins/${encodeURIComponent(coinId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);
    await loadCoinsTable();
    if (currentView === "dashboard") await refreshDashboard({ reRender: true });
  } catch (err) {
    alert(err.message || "Failed to update group");
  }
}

function showFormError(msg) {
  coinFormError.textContent = msg;
  coinFormError.classList.toggle("hidden", !msg);
}

async function removeCoin(id) {
  if (!confirm(`Remove ${id} from the coin list?`)) return;

  try {
    const res = await fetch(`/api/coins/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }
    lastRenderedAt = null;
    await loadCoinsTable();
    if (currentView === "dashboard") await refreshDashboard({ forceImages: true });
  } catch (err) {
    alert(err.message || "Failed to remove coin");
  }
}

document.querySelectorAll(".menu-item").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

historyBackBtn.addEventListener("click", loadHistoryList);

lightbox.querySelectorAll("[data-close-lightbox]").forEach((el) => {
  el.addEventListener("click", closeLightbox);
});

signalChartModal?.querySelectorAll("[data-close-signal-modal]").forEach((el) => {
  el.addEventListener("click", closeSignalChartModal);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!lightbox.classList.contains("hidden")) closeLightbox();
    if (!signalChartModal?.classList.contains("hidden")) closeSignalChartModal();
  }
});

async function refreshGroup() {
  if (activeGroup === "all") return;

  lastProgressKey = "";

  try {
    const dash = await fetchDashboard();
    cachedCoins = dash.coins;
    const groupCoins = dash.coins.filter((c) => c.group === activeGroup);

    renderDashboardGrid(dash.coins, {
      running: true,
      progress: {
        total: groupCoins.length,
        partialResults: [],
        currentCoin: null,
        currentCoinStartedAt: null,
        singleCoin: null,
        group: activeGroup,
      },
      lastResults: dash.state.lastResults || [],
    }, dash.state.lastRun?.at);

    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: activeGroup }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    setBadge("Capturing...", "running");
    refreshBtn.disabled = true;
    refreshGroupBtn.disabled = true;
    startStatusPoll();
    await pollCaptureStatus();
  } catch (err) {
    alert(err.message || "Failed to refresh group");
    await refreshDashboard({ reRender: true });
  }
}

refreshGroupBtn.addEventListener("click", refreshGroup);

clearCompareBtn.addEventListener("click", () => {
  compareSelection.clear();
  refreshDashboard({ reRender: true });
  if (currentView === "compare") renderCompareView();
});

refreshSignalChartBtn?.addEventListener("click", loadSignalChart);
pnlDaysSelect?.addEventListener("change", () => {
  tradeJournalPage = 1;
  loadTradeJournal();
});
tradeJournalFilter?.addEventListener("change", () => {
  tradeJournalPage = 1;
  renderTradeJournalList(cachedTradeJournal);
});
refreshTradeJournalBtn?.addEventListener("click", loadTradeJournal);
runLocalAnalyzeBtn?.addEventListener("click", runLocalAnalyze);
localAnalyzeDays?.addEventListener("change", () => loadLocalAnalyze({ force: true }));
signalDaysSelect?.addEventListener("change", loadSignalChart);

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  setBadge("Starting...", "running");
  lastProgressKey = "";

  try {
    const dash = await fetchDashboard();
    cachedCoins = dash.coins;
    renderDashboardGrid(dash.coins, {
      running: true,
      progress: {
        partialResults: [],
        currentCoin: null,
        currentCoinStartedAt: null,
        singleCoin: null,
      },
      lastResults: [],
    }, null);

    const res = await fetch("/api/capture", { method: "POST" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);
    startStatusPoll();
    await pollCaptureStatus();
  } catch (err) {
    setBadge("Error", "error");
    refreshBtn.disabled = false;
    alert(err.message || "Capture failed to start");
  }
});

async function refreshSingleCoin(coinId) {
  lastProgressKey = "";

  try {
    const dash = await fetchDashboard();
    cachedCoins = dash.coins;
    renderDashboardGrid(dash.coins, {
      running: true,
      progress: {
        total: 1,
        partialResults: [],
        currentCoin: coinId,
        currentCoinStartedAt: Date.now(),
        singleCoin: coinId,
      },
      lastResults: dash.state.lastResults || [],
    }, dash.state.lastRun?.at);

    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coinId }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    setBadge("Capturing...", "running");
    refreshBtn.disabled = true;
    startStatusPoll();
    await pollCaptureStatus();
  } catch (err) {
    alert(err.message || "Failed to refresh coin");
    await refreshDashboard();
  }
}

autoRefreshBtn.addEventListener("click", async () => {
  const nextEnabled = !currentSettings.autoRefreshEnabled;
  autoRefreshBtn.disabled = true;

  try {
    const res = await fetch("/api/auto-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    applySettings(data.settings);
  } catch (err) {
    alert(err.message || "Failed to toggle auto-refresh");
  } finally {
    autoRefreshBtn.disabled = false;
  }
});

addCoinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showFormError("");

  const form = new FormData(addCoinForm);
  const body = {
    name: form.get("name"),
    symbol: form.get("symbol"),
    id: form.get("id") || undefined,
    group: form.get("group") || "majors",
  };

  try {
    const res = await fetch("/api/coins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    addCoinForm.reset();
    lastRenderedAt = null;
    await loadCoinsTable();
    if (currentView === "dashboard") await refreshDashboard({ forceImages: true });
  } catch (err) {
    showFormError(err.message || "Failed to add coin");
  }
});

function showSettingsMessage(errorMsg, successMsg) {
  settingsFormError.textContent = errorMsg || "";
  settingsFormError.classList.toggle("hidden", !errorMsg);
  settingsFormSuccess.textContent = successMsg || "";
  settingsFormSuccess.classList.toggle("hidden", !successMsg);
}

function updateTvSessionUI(session) {
  tvSessionStatus.textContent = session.message;
  tvSessionStatus.classList.remove("ok", "warn", "error");

  if (session.loginBrowserOpen) {
    tvSessionStatus.classList.add("warn");
  } else if (session.loggedIn) {
    tvSessionStatus.classList.add("ok");
  } else {
    tvSessionStatus.classList.add("error");
  }
}

async function loadTvSession() {
  try {
    const res = await fetch("/api/tradingview/session");
    const { session } = await res.json();
    updateTvSessionUI(session);
  } catch {
    tvSessionStatus.textContent = "Could not check TradingView login status.";
    tvSessionStatus.classList.add("error");
  }
}

function fillBinanceSettings(settings) {
  settingsForm.autoTradeEnabled.checked = Boolean(settings.autoTradeEnabled);
  if (settingsForm.autoTradeRequireGuidelines) {
    settingsForm.autoTradeRequireGuidelines.checked =
      settings.autoTradeRequireGuidelines !== false;
  }
  settingsForm.binanceTestnet.checked = Boolean(settings.binanceTestnet);
  settingsForm.binanceApiKey.value = "";
  settingsForm.binanceApiSecret.value = "";
  settingsForm.tradeAmountUsdt.value = settings.tradeAmountUsdt ?? 2;
  settingsForm.tradeLeverage.value = settings.tradeLeverage ?? 10;
  settingsForm.tradeMarginType.value = settings.tradeMarginType || "ISOLATED";
  settingsForm.tradeTpPercent.value = settings.tradeTpPercent ?? 30;
  settingsForm.tradeSlPercent.value = settings.tradeSlPercent ?? 30;
  settingsForm.tradeMode.value = settings.tradeMode || "long_only";

  if (binanceKeyStatus) {
    binanceKeyStatus.textContent = settings.binanceApiKeyConfigured
      ? `API key: saved (${settings.binanceApiKeyMasked})`
      : "API key: not set";
  }
  if (binanceSecretStatus) {
    binanceSecretStatus.textContent = settings.binanceApiSecretConfigured
      ? "Secret key: saved (hidden)"
      : "Secret key: not set";
  }
  if (binanceTestStatus) binanceTestStatus.textContent = "";
}

async function loadTradeLog() {
  if (!tradeLogTable) return;

  try {
    const res = await fetch("/api/trades?limit=20");
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    const trades = data.trades || [];
    if (trades.length === 0) {
      tradeLogTable.innerHTML = `<p class="empty-state">No auto-trades yet. Enable auto-trade and wait for a new BUY/SELL signal.</p>`;
      return;
    }

    tradeLogTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Coin</th>
            <th>Signal</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${trades
            .map((t) => {
              const details =
                t.status === "error"
                  ? `<span class="text-error">${t.error || "Failed"}</span>`
                  : t.status === "skipped"
                    ? `<span class="text-muted">${t.reason || "Skipped"}</span>`
                    : (t.actions || [])
                      .map((a) => {
                        if (a.action === "take_profit" || a.action === "stop_loss") {
                          return `${a.action} @ ${a.stopPrice} (${a.percent}%)`;
                        }
                        return `${a.action}${a.quantity != null ? ` ${a.quantity}` : ""}`;
                      })
                      .join(", ") || "—";
              return `
                <tr>
                  <td>${formatTime(t.at)}</td>
                  <td>${t.coinName || t.coinId}<div class="card-symbol">${t.symbol || ""}</div></td>
                  <td class="signal-cell-${t.signal || "none"}">${(t.signal || "—").toUpperCase()}</td>
                  <td>${t.status === "ok" ? "OK" : t.status === "error" ? "Error" : t.status === "skipped" ? "Blocked" : t.status || "—"}</td>
                  <td>${details}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    tradeLogTable.innerHTML = `<p class="empty-state text-error">${err.message || "Failed to load trades."}</p>`;
  }
}

async function loadSettingsForm() {
  try {
    const res = await fetch("/api/settings");
    const { settings } = await res.json();
    settingsForm.autoRefreshMinutes.value = settings.autoRefreshMinutes;
    settingsForm.columnsPerRow.value = String(settings.columnsPerRow);
    settingsForm.chartLayoutId.value = settings.chartLayoutId || "";
    settingsForm.chartInterval.value = settings.chartInterval || "15";
    settingsForm.alertThresholdPercent.value = settings.alertThresholdPercent ?? 3;
    settingsForm.historyPerPage.value = settings.historyPerPage ?? 10;
    settingsForm.screenshotWaitSeconds.value = settings.screenshotWaitSeconds ?? 5;
    settingsForm.chartLoadMaxRetries.value = settings.chartLoadMaxRetries ?? 6;
    fillBinanceSettings(settings);
    showSettingsMessage("", "");
    await loadTvSession();
    await loadTradeLog();
  } catch {
    showSettingsMessage("Failed to load settings.", "");
  }
}

tvLoginBtn.addEventListener("click", async () => {
  tvLoginBtn.disabled = true;
  showSettingsMessage("", "");

  try {
    const res = await fetch("/api/tradingview/login", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    updateTvSessionUI({
      loggedIn: null,
      loginBrowserOpen: true,
      message: data.message || "Login window opened.",
    });
    showSettingsMessage("", "Login window opened — sign in, then click Save Login.");
  } catch (err) {
    showSettingsMessage(err.message || "Failed to open login window.", "");
  } finally {
    tvLoginBtn.disabled = false;
  }
});

tvSaveLoginBtn.addEventListener("click", async () => {
  tvSaveLoginBtn.disabled = true;
  showSettingsMessage("", "");

  try {
    const res = await fetch("/api/tradingview/login/save", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    updateTvSessionUI(data.session);
    showSettingsMessage(
      "",
      data.session.loggedIn
        ? "Login saved. Screenshots will use your indicators."
        : "Login window closed. Sign in and try again if needed."
    );
  } catch (err) {
    showSettingsMessage(err.message || "Failed to save login.", "");
  } finally {
    tvSaveLoginBtn.disabled = false;
  }
});

binanceTestBtn?.addEventListener("click", async () => {
  binanceTestBtn.disabled = true;
  if (binanceTestStatus) binanceTestStatus.textContent = "Testing connection…";

  try {
    const res = await fetch("/api/binance/test", { method: "POST" });
    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error);

    if (binanceTestStatus) {
      binanceTestStatus.textContent = `Connected${data.testnet ? " (testnet)" : ""}. Available: $${Number(data.availableBalance || 0).toFixed(2)} USDT`;
      binanceTestStatus.classList.remove("error");
      binanceTestStatus.classList.add("ok");
    }
  } catch (err) {
    if (binanceTestStatus) {
      binanceTestStatus.textContent = err.message || "Connection failed";
      binanceTestStatus.classList.remove("ok");
      binanceTestStatus.classList.add("error");
      binanceTestStatus.style.whiteSpace = "pre-wrap";
    }
  } finally {
    binanceTestBtn.disabled = false;
  }
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showSettingsMessage("", "");

  const form = new FormData(settingsForm);
  const body = {
    autoRefreshMinutes: Number(form.get("autoRefreshMinutes")),
    columnsPerRow: Number(form.get("columnsPerRow")),
    chartLayoutId: form.get("chartLayoutId"),
    chartInterval: form.get("chartInterval"),
    alertThresholdPercent: Number(form.get("alertThresholdPercent")),
    historyPerPage: Number(form.get("historyPerPage")),
    screenshotWaitSeconds: Number(form.get("screenshotWaitSeconds")),
    chartLoadMaxRetries: Number(form.get("chartLoadMaxRetries")),
    autoTradeEnabled: settingsForm.autoTradeEnabled.checked,
    autoTradeRequireGuidelines: settingsForm.autoTradeRequireGuidelines?.checked !== false,
    binanceTestnet: settingsForm.binanceTestnet.checked,
    tradeAmountUsdt: Number(form.get("tradeAmountUsdt")),
    tradeLeverage: Number(form.get("tradeLeverage")),
    tradeMarginType: form.get("tradeMarginType"),
    tradeTpPercent: Number(form.get("tradeTpPercent")),
    tradeSlPercent: Number(form.get("tradeSlPercent")),
    tradeMode: form.get("tradeMode"),
  };

  const apiKey = String(form.get("binanceApiKey") || "").trim();
  const apiSecret = String(form.get("binanceApiSecret") || "").trim();
  if (apiKey) body.binanceApiKey = apiKey;
  if (apiSecret) body.binanceApiSecret = apiSecret;

  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    applySettings(data.settings);
    fillBinanceSettings(data.settings);
    showSettingsMessage("", "Settings saved.");
    await loadTradeLog();
    if (currentView === "dashboard") {
      const dash = await fetchDashboard();
      renderDashboardGrid(dash.coins, dash.state, dash.state.lastRun?.at);
    }
    if (currentView === "history" && historyDetail.classList.contains("hidden")) {
      renderHistoryPage();
    }
  } catch (err) {
    showSettingsMessage(err.message || "Failed to save settings.", "");
  }
});

async function initDashboard() {
  await refreshDashboard({ forceImages: true });

  try {
    const data = await fetchStatus();
    if (data.running || data.signalAnalysis?.running) {
      startStatusPoll();
      await pollCaptureStatus();
    }
  } catch {
    // Initial status check is best-effort.
  }

  startAutoWatch();
}

showView("dashboard");
initDashboard();
