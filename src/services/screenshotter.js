const fs = require("fs/promises");
const path = require("path");
const puppeteer = require("puppeteer");
const { getCoins } = require("./coinsStore");
const { getSettings } = require("./settingsStore");
const { CURRENT_DIR } = require("./historyStore");
const {
  getBrowserLaunchOptions,
  assertProfileAvailable,
} = require("./tradingviewSession");

const CHART_WIDTH = 1280;
const CHART_HEIGHT = 720;

// Keep waits short — interval is already in the chart URL.
const FIRST_SETTLE_MS = 1200;
const SWITCH_SETTLE_MS = 700;
const QUICK_SETTLE_MS = 600;
const API_PROBE_MS = 3000;
const CANVAS_TIMEOUT_MS = 15000;
const GOTO_TIMEOUT_MS = 45000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildChartUrl(symbol, settings) {
  const cfg = settings || (await getSettings());
  const params = new URLSearchParams({
    symbol,
    interval: cfg.chartInterval || "15",
  });

  const layoutId = cfg.chartLayoutId?.trim();
  if (layoutId) {
    return `https://www.tradingview.com/chart/${layoutId}/?${params.toString()}`;
  }

  return `https://www.tradingview.com/chart/?${params.toString()}`;
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const labels = ["Accept all", "I agree", "Got it", "Accept"];
    for (const btn of document.querySelectorAll("button")) {
      const text = btn.textContent?.trim() || "";
      if (labels.some((label) => text.includes(label))) {
        btn.click();
      }
    }
  });

  const selectors = [
    'button[data-name="close"]',
    'button[aria-label="Close"]',
  ];

  for (const selector of selectors) {
    try {
      const button = await page.$(selector);
      if (button) await button.click();
    } catch {
      // Overlay not present.
    }
  }
}

async function hasChartApi(page) {
  return page.evaluate(
    () =>
      typeof window.TradingView !== "undefined" &&
      typeof window.TradingView.activeChart === "function" &&
      Boolean(window.TradingView.activeChart())
  );
}

async function waitForChartApi(page, timeout = API_PROBE_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await hasChartApi(page)) return true;
    await sleep(200);
  }
  return false;
}

async function waitForCanvas(page, timeout = CANVAS_TIMEOUT_MS) {
  await page.waitForSelector("canvas", { timeout });
}

async function applyChartInterval(page, interval) {
  if (!(await hasChartApi(page))) return false;

  try {
    await page.evaluate((intv) => {
      window.TradingView.activeChart().setResolution(intv);
    }, interval);
    return true;
  } catch {
    return false;
  }
}

async function gotoChart(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: GOTO_TIMEOUT_MS,
  });
  await waitForCanvas(page);
}

async function initializeChart(page, coin, settings) {
  const url = await buildChartUrl(coin.symbol, settings);
  await gotoChart(page, url);
  await dismissOverlays(page);

  const apiReady = await waitForChartApi(page);
  if (apiReady) {
    await applyChartInterval(page, settings.chartInterval || "15");
  }

  await sleep(FIRST_SETTLE_MS);
  return apiReady;
}

async function quickNavigateSymbol(page, coin, settings) {
  const url = await buildChartUrl(coin.symbol, settings);
  await gotoChart(page, url);
  await sleep(QUICK_SETTLE_MS);
}

async function switchChartSymbol(page, symbol) {
  const switched = await page.evaluate((sym) => {
    return new Promise((resolve) => {
      const chart = window.TradingView?.activeChart?.();
      if (!chart) {
        resolve(false);
        return;
      }

      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };

      const timer = setTimeout(() => done(true), 6000);

      try {
        chart.setSymbol(sym, () => {
          clearTimeout(timer);
          done(true);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
  }, symbol);

  if (!switched) {
    throw new Error("Chart API symbol switch failed");
  }

  await sleep(SWITCH_SETTLE_MS);
}

async function prepareChart(page, coin, settings, canFastSwitch, isFirst) {
  if (isFirst) {
    return initializeChart(page, coin, settings);
  }

  if (canFastSwitch) {
    try {
      await switchChartSymbol(page, coin.symbol);
      return true;
    } catch {
      await quickNavigateSymbol(page, coin, settings);
      return hasChartApi(page);
    }
  }

  await quickNavigateSymbol(page, coin, settings);
  return hasChartApi(page);
}

async function captureAllCoins({ coinIds = null, onProgress } = {}) {
  let coins = await getCoins();
  if (coinIds?.length) {
    coins = coins.filter((c) => coinIds.includes(c.id));
    if (coins.length === 0) {
      throw new Error("Coin not found");
    }
  }
  if (coins.length === 0) {
    return [];
  }

  await assertProfileAvailable();
  await fs.mkdir(CURRENT_DIR, { recursive: true });

  const settings = await getSettings();
  const browser = await puppeteer.launch(getBrowserLaunchOptions({ headless: true }));

  const results = [];
  let page;
  let canFastSwitch = false;

  try {
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(GOTO_TIMEOUT_MS);
    page.setDefaultTimeout(CANVAS_TIMEOUT_MS);

    await page.setViewport({ width: CHART_WIDTH, height: CHART_HEIGHT });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const startedAt = Date.now();

      onProgress?.({
        phase: "start",
        current: i + 1,
        total: coins.length,
        coin: coin.id,
        startedAt,
      });

      try {
        canFastSwitch = await prepareChart(
          page,
          coin,
          settings,
          canFastSwitch,
          i === 0
        );

        const filePath = path.join(CURRENT_DIR, `${coin.id}.png`);
        await page.screenshot({ path: filePath, fullPage: false });

        const durationMs = Date.now() - startedAt;
        const result = { coin: coin.id, status: "ok", file: filePath, durationMs };
        results.push(result);
        onProgress?.({
          phase: "done",
          current: i + 1,
          total: coins.length,
          coin: coin.id,
          result,
        });
      } catch (err) {
        canFastSwitch = false;
        const durationMs = Date.now() - startedAt;
        const result = {
          coin: coin.id,
          status: "error",
          error: err.message,
          durationMs,
        };
        results.push(result);
        onProgress?.({
          phase: "done",
          current: i + 1,
          total: coins.length,
          coin: coin.id,
          result,
        });
      }
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return results;
}

module.exports = { captureAllCoins, CURRENT_DIR };
