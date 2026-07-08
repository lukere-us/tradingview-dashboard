/** How long to treat a BUY/SELL as "same" (no repeat trade / keep showing). */
const HOLD_CANDLES = 2;

/** Consecutive captures with same direction before a flip counts as one chart label. */
const MIN_EPISODE_RUN = 3;

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

/**
 * One chart episode per direction — count again only after BUY↔SELL flips.
 * Matches visible Future Trend Pro labels (not every screenshot capture).
 */
function isSameSignalEpisode(lastSignal, signal) {
  return Boolean(lastSignal && signal && lastSignal === signal);
}

/**
 * Collapse screenshot detections into chart episodes.
 * - First signal in the window always counts (ongoing label at window start).
 * - Direction flips count only after MIN_EPISODE_RUN consecutive captures agree.
 */
function filterSignalEpisodes(entries, minRun = MIN_EPISODE_RUN) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
  const kept = [];
  let lastKeptSignal = null;
  let index = 0;

  while (index < sorted.length) {
    const signal = sorted[index].signal;
    if (signal !== "buy" && signal !== "sell") {
      index++;
      continue;
    }

    let end = index;
    while (end < sorted.length && sorted[end].signal === signal) end++;
    const runLen = end - index;

    if (lastKeptSignal === null) {
      kept.push(sorted[index]);
      lastKeptSignal = signal;
    } else if (signal !== lastKeptSignal && runLen >= minRun) {
      kept.push(sorted[index]);
      lastKeptSignal = signal;
    }

    index = end;
  }

  return kept;
}

module.exports = {
  HOLD_CANDLES,
  MIN_EPISODE_RUN,
  candleDurationMs,
  holdDurationMs,
  resolveLastActed,
  isSameSignalEpisode,
  filterSignalEpisodes,
};
