const fs = require("fs/promises");
const path = require("path");
const { analyzeCoinSignal } = require("./chartSignal");
const { recordSignalEvent } = require("./signalHistoryStore");
const { resolveLastActed, HOLD_CANDLES } = require("./signalMemory");
const { getSettings } = require("./settingsStore");
const { getCoins } = require("./coinsStore");
const { executeSignalTrade, logTradeError, logTradeSkipped, futuresSymbol } = require("./binanceTrade");
const { checkTradeGuidelines, buildTradeAnalysis } = require("./tradeGuidelines");
const { patchSetMeta } = require("./historyStore");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SIGNALS_FILE = path.join(DATA_DIR, "signals.json");

async function loadSignals() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(SIGNALS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSignals(signals) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SIGNALS_FILE, JSON.stringify(signals, null, 2));
}

async function getSignals() {
  const signals = await loadSignals();
  const settings = await getSettings().catch(() => ({ chartInterval: "15" }));
  const interval = settings.chartInterval || "15";
  const now = Date.now();
  const coinIds = Object.keys(signals);

  const liveByCoin = {};
  await Promise.all(
    coinIds.map(async (coinId) => {
      try {
        liveByCoin[coinId] = await analyzeCoinSignal(coinId);
      } catch {
        liveByCoin[coinId] = {
          signal: "none",
          position: null,
          highlight: null,
        };
      }
    })
  );

  const out = {};
  for (const coinId of coinIds) {
    const row = signals[coinId];
    const live = liveByCoin[coinId] || {
      signal: "none",
      position: null,
      highlight: null,
    };
    const { lastActed, lastActedAt, holdActive } = resolveLastActed(
      row,
      interval,
      now
    );
    out[coinId] = {
      ...row,
      signal: live.signal || "none",
      position: live.position ?? null,
      highlight: live.highlight ?? null,
      markers: live.markers ?? null,
      analyzedAt: live.analyzedAt || row.analyzedAt,
      lastActedSignal: lastActed,
      lastActedAt,
      holdActive,
    };
  }
  return out;
}

async function updateSignalsForCoins(coinIds, onProgress, options = {}) {
  const { historySetId = null } = options;
  const current = await loadSignals();
  const settings = await getSettings();
  const interval = settings.chartInterval || "15";
  const coins = await getCoins();
  const coinMap = Object.fromEntries(coins.map((c) => [c.id, c]));
  const activeCoinIds = coinIds.filter((id) => coinMap[id]?.enabled !== false);
  const captureSnapshots = {};

  for (let i = 0; i < activeCoinIds.length; i++) {
    const coinId = activeCoinIds[i];
    onProgress?.({
      phase: "start",
      coinId,
      current: i + 1,
      total: activeCoinIds.length,
    });

    const previous = current[coinId] || null;
    const { lastActed, lastActedAt, holdActive } = resolveLastActed(
      previous,
      interval
    );
    const previousForRecord = {
      ...previous,
      lastActedSignal: lastActed,
      lastActedAt,
    };

    const result = await analyzeCoinSignal(coinId);
    const event = await recordSignalEvent(
      coinId,
      result,
      previousForRecord,
      interval
    ).catch(() => null);

    let guide = null;
    if (result.signal === "buy" || result.signal === "sell") {
      guide = await checkTradeGuidelines({
        coinId,
        signal: result.signal,
        settings,
      });
    }

    captureSnapshots[coinId] = {
      signal: result.signal || "none",
      position: result.position || null,
      highlight: result.highlight || null,
      markers: result.markers || null,
      analyzedAt: result.analyzedAt,
      isNewSignal: Boolean(event),
      guidelinesOk: guide ? guide.ok : null,
      guidelinePassPercent: guide?.passStats?.percent ?? null,
      guidelineFailures: guide?.failures || [],
    };

    let nextActed = lastActed;
    let nextActedAt = lastActedAt;
    let nextHold = holdActive;

    if (event && (event.signal === "buy" || event.signal === "sell")) {
      nextActed = event.signal;
      nextActedAt = event.at;
      nextHold = true;
    } else if (!holdActive) {
      nextActed = null;
      nextActedAt = null;
      nextHold = false;
    }

    // Live chart signal only for UI. Memory fields prevent repeat trades, not display.
    current[coinId] = {
      ...result,
      lastActedSignal: nextActed,
      lastActedAt: nextActedAt,
      holdActive: nextHold,
      holdCandles: HOLD_CANDLES,
      isNewSignal: Boolean(event),
      analyzedAt: result.analyzedAt,
    };

    if (event && (event.signal === "buy" || event.signal === "sell")) {
      const coin = coinMap[coinId];
      console.log(
        `New signal (${coinId}): ${event.signal} (hold ${HOLD_CANDLES} candles)`
      );
      try {
        if (coin && guide) {
          const analysis = buildTradeAnalysis({
            coinId,
            signal: event.signal,
            chartResult: result,
            guide,
            settings,
          });

          if (!guide.ok) {
            const reason = guide.failures.join("; ");
            console.log(`Auto-trade blocked (${coinId}): ${reason}`);
            await logTradeSkipped({
              coinId,
              coinName: coin.name,
              symbol: futuresSymbol(coin.symbol),
              signal: event.signal,
              reason,
              guidelines: guide.status,
              analysis,
            }).catch(() => {});
          } else {
            const trade = await executeSignalTrade({
              coin,
              signal: event.signal,
              settings,
              analysis,
            });
            if (trade?.skipped) {
              console.log(`Auto-trade skipped (${coinId}): ${trade.reason}`);
              await logTradeSkipped({
                coinId,
                coinName: coin.name,
                symbol: futuresSymbol(coin.symbol),
                signal: event.signal,
                reason: trade.reason,
                analysis,
              }).catch(() => {});
            } else if (trade?.status === "ok") {
              console.log(`Auto-trade placed (${coinId} ${event.signal})`);
            }
          }
        }
      } catch (err) {
        console.error(`Auto-trade failed (${coinId}):`, err.message);
        const analysis = buildTradeAnalysis({
          coinId,
          signal: event.signal,
          chartResult: result,
          guide: guide || { ok: false, failures: [err.message] },
          settings,
        });
        await logTradeError({
          coinId,
          coinName: coinMap[coinId]?.name,
          symbol: coinMap[coinId] ? futuresSymbol(coinMap[coinId].symbol) : "",
          signal: event.signal,
          error: err.message,
          analysis,
        }).catch(() => {});
      }
    } else if (
      (result.signal === "buy" || result.signal === "sell") &&
      holdActive &&
      result.signal === lastActed
    ) {
      console.log(
        `Same signal ignored (${coinId}): ${result.signal} (within ${HOLD_CANDLES} candles)`
      );
    }

    onProgress?.({
      phase: "done",
      coinId,
      result: current[coinId],
      current: i + 1,
      total: activeCoinIds.length,
    });
  }

  await saveSignals(current);

  if (historySetId && Object.keys(captureSnapshots).length > 0) {
    await patchSetMeta(historySetId, { signals: captureSnapshots }).catch((err) => {
      console.error(`Failed to save capture signals (${historySetId}):`, err.message);
    });
  }

  return current;
}

module.exports = {
  getSignals,
  updateSignalsForCoins,
};
