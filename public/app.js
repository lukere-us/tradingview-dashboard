const views = {
  dashboard: document.getElementById("view-dashboard"),
  history: document.getElementById("view-history"),
  coins: document.getElementById("view-coins"),
  compare: document.getElementById("view-compare"),
  signals: document.getElementById("view-signals"),
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
  if (!chartSignal || chartSignal.signal === "none") {
    return `<span class="card-analyze-status none"> · No signal</span>`;
  }

  const label = chartSignal.signal.toUpperCase();
  const pos =
    chartSignal.position === "top"
      ? " top"
      : chartSignal.position === "bottom"
        ? " bottom"
        : "";
  const cls = chartSignal.highlight || "flat";

  return `<span class="card-analyze-status ${cls}"> · ${label}${pos}</span>`;
}

function renderTitleAnalyzeStatus(coin, { signalAnalysis, chartSignal }) {
  const queue = signalAnalysis?.queue || [];
  const inQueue = queue.includes(coin.id);

  if (signalAnalysis?.running && inQueue) {
    if (signalAnalysis.current === coin.id) {
      return `<span class="card-analyze-status analyzing"> · Scanning chart edge…</span>`;
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
      const label = formatDuration(now - progress.currentCoinStartedAt);
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
  document.querySelectorAll(".menu-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });

  if (name === "history") refreshHistoryList();
  if (name === "coins") loadCoinsTable();
  if (name === "settings") loadSettingsForm();
  if (name === "compare") renderCompareView();
  if (name === "signals") loadSignalChart();
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
  const days = Number(signalDaysSelect?.value) || 7;
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

function renderSignalChart(data) {
  const { days = [], coins = [], totals = { buy: 0, sell: 0 } } = data;

  signalChartSummary.innerHTML = `
    <p><strong>Buy signals:</strong> <span class="signal-total buy">${totals.buy}</span></p>
    <p><strong>Sell signals:</strong> <span class="signal-total sell">${totals.sell}</span></p>
    <p><strong>Range:</strong> ${days[0] || "—"} → ${days[days.length - 1] || "—"}</p>
  `;

  const maxTotal = Math.max(
    1,
    ...coins.map((c) => c.totals.buy + c.totals.sell)
  );

  if (coins.length === 0) {
    signalChartBars.innerHTML = `<p class="empty-state">No coins configured.</p>`;
    signalChartTable.innerHTML = "";
    return;
  }

  signalChartBars.innerHTML = coins
    .map((coin) => {
      const buyPct = (coin.totals.buy / maxTotal) * 100;
      const sellPct = (coin.totals.sell / maxTotal) * 100;
      return `
        <div class="signal-bar-row">
          <div class="signal-bar-label">
            <strong>${coin.name}</strong>
            <span>${coin.totals.buy} buy · ${coin.totals.sell} sell</span>
          </div>
          <div class="signal-bar-track">
            <div class="signal-bar buy" style="width:${buyPct}%" title="${coin.totals.buy} buy"></div>
            <div class="signal-bar sell" style="width:${sellPct}%" title="${coin.totals.sell} sell"></div>
          </div>
        </div>
      `;
    })
    .join("");

  const dayHeaders = days.map((d) => `<th>${formatDayLabel(d)}</th>`).join("");

  signalChartTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Coin</th>
          <th>Buy</th>
          <th>Sell</th>
          ${dayHeaders}
        </tr>
      </thead>
      <tbody>
        ${coins
          .map((coin) => {
            const dayCells = days
              .map((day) => {
                const cell = coin.days[day] || { buy: 0, sell: 0 };
                if (cell.buy === 0 && cell.sell === 0) {
                  return `<td class="signal-cell empty">—</td>`;
                }
                return `<td class="signal-cell">
                  <span class="signal-cell-buy">${cell.buy}</span>
                  <span class="signal-cell-sep">/</span>
                  <span class="signal-cell-sell">${cell.sell}</span>
                </td>`;
              })
              .join("");

            return `
              <tr>
                <td><strong>${coin.name}</strong><div class="card-symbol">${coin.id}</div></td>
                <td class="signal-cell-buy"><strong>${coin.totals.buy}</strong></td>
                <td class="signal-cell-sell"><strong>${coin.totals.sell}</strong></td>
                ${dayCells}
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
    <p class="field-hint">Each day cell shows buy / sell counts. A signal is counted once when it newly appears (not on every capture).</p>
  `;
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
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
                  <td>${t.status === "ok" ? "OK" : t.status === "error" ? "Error" : t.status || "—"}</td>
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
    autoTradeEnabled: settingsForm.autoTradeEnabled.checked,
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
