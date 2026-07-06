/** How long to treat a BUY/SELL as "same" (no repeat trade / keep showing). */
const HOLD_CANDLES = 2;

function candleDurationMs(interval) {
  const key = String(interval || "15");
  const map = {
    1: 60_000,
    3: 180_000,
    5: 300_000,
    15: 900_000,
    30: 1_800_000,
    60: 3_600_000,
    120: 7_200_000,
    240: 14_400_000,
    D: 86_400_000,
    W: 604_800_000,
  };
  return map[key] || map[15];
}

function holdDurationMs(chartInterval) {
  return HOLD_CANDLES * candleDurationMs(chartInterval);
}

/**
 * Resolve active last-acted signal. Expires after HOLD_CANDLES chart candles.
 */
function resolveLastActed(previous, chartInterval, now = Date.now()) {
  let signal = previous?.lastActedSignal || null;
  let at = previous?.lastActedAt || null;

  if (!signal && (previous?.signal === "buy" || previous?.signal === "sell")) {
    signal = previous.signal;
    at = previous.lastActedAt || previous.analyzedAt || null;
  }

  if (!signal || !at) {
    return { lastActed: null, lastActedAt: null, holdActive: false };
  }

  const actedAt = new Date(at).getTime();
  if (!Number.isFinite(actedAt)) {
    return { lastActed: null, lastActedAt: null, holdActive: false };
  }

  const holdActive = now - actedAt < holdDurationMs(chartInterval);
  if (!holdActive) {
    return { lastActed: null, lastActedAt: null, holdActive: false };
  }

  return { lastActed: signal, lastActedAt: at, holdActive: true };
}

module.exports = {
  HOLD_CANDLES,
  candleDurationMs,
  holdDurationMs,
  resolveLastActed,
};
