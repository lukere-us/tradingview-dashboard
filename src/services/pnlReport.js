const { listTrades } = require("./binanceTrade");
const {
  fetchAccountSnapshot,
  fetchIncomeHistory,
  fetchOpenPositions,
} = require("./binanceTrade");
const { getActiveCoins } = require("./coinsStore");

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function roundUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function symbolToCoinId(symbol, coins) {
  const sym = String(symbol || "").toUpperCase();
  const hit = coins.find((c) => {
    const s = String(c.symbol || "")
      .replace(/^[^:]+:/i, "")
      .toUpperCase();
    return s === sym;
  });
  return hit?.id || sym.replace(/USDT$/, "").toLowerCase();
}

function aggregateIncome(incomeRows, coins) {
  const byDay = {};
  const bySymbol = {};
  const events = [];
  let realizedPnl = 0;
  let commission = 0;
  let wins = 0;
  let losses = 0;

  for (const row of incomeRows) {
    const amount = Number(row.income || 0);
    const type = row.incomeType;
    const time = Number(row.time);
    const symbol = row.symbol || "—";
    const day = dayKey(time);

    if (type === "REALIZED_PNL") {
      realizedPnl += amount;
      if (amount > 0) wins++;
      else if (amount < 0) losses++;

      if (!byDay[day]) byDay[day] = { date: day, realizedPnl: 0, commission: 0, net: 0, events: 0 };
      byDay[day].realizedPnl += amount;
      byDay[day].events++;
      byDay[day].net += amount;

      if (!bySymbol[symbol]) {
        bySymbol[symbol] = {
          symbol,
          coinId: symbolToCoinId(symbol, coins),
          realizedPnl: 0,
          commission: 0,
          net: 0,
          wins: 0,
          losses: 0,
          events: 0,
        };
      }
      bySymbol[symbol].realizedPnl += amount;
      bySymbol[symbol].net += amount;
      bySymbol[symbol].events++;
      if (amount > 0) bySymbol[symbol].wins++;
      else if (amount < 0) bySymbol[symbol].losses++;

      events.push({
        at: new Date(time).toISOString(),
        symbol,
        coinId: symbolToCoinId(symbol, coins),
        type: "REALIZED_PNL",
        amount: roundUsd(amount),
        tradeId: row.tradeId || null,
        tranId: row.tranId || null,
      });
    } else if (type === "COMMISSION") {
      commission += amount;
      if (!byDay[day]) byDay[day] = { date: day, realizedPnl: 0, commission: 0, net: 0, events: 0 };
      byDay[day].commission += amount;
      byDay[day].net += amount;

      if (!bySymbol[symbol]) {
        bySymbol[symbol] = {
          symbol,
          coinId: symbolToCoinId(symbol, coins),
          realizedPnl: 0,
          commission: 0,
          net: 0,
          wins: 0,
          losses: 0,
          events: 0,
        };
      }
      bySymbol[symbol].commission += amount;
      bySymbol[symbol].net += amount;
    }
  }

  const dayList = Object.values(byDay)
    .map((d) => ({
      ...d,
      realizedPnl: roundUsd(d.realizedPnl),
      commission: roundUsd(d.commission),
      net: roundUsd(d.net),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const symbolList = Object.values(bySymbol)
    .map((s) => ({
      ...s,
      realizedPnl: roundUsd(s.realizedPnl),
      commission: roundUsd(s.commission),
      net: roundUsd(s.net),
    }))
    .sort((a, b) => b.net - a.net);

  return {
    realizedPnl: roundUsd(realizedPnl),
    commission: roundUsd(commission),
    netPnl: roundUsd(realizedPnl + commission),
    closedEvents: wins + losses,
    wins,
    losses,
    winRate: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
    byDay: dayList,
    bySymbol: symbolList,
    events: events.sort((a, b) => b.at.localeCompare(a.at)),
  };
}

function localTradeStats(trades) {
  const executed = trades.filter((t) => t.status === "ok");
  let totalNotional = 0;

  for (const trade of executed) {
    const open = (trade.actions || []).find(
      (a) => a.action === "open_long" || a.action === "open_short"
    );
    if (open?.quantity && open?.price) {
      totalNotional += Number(open.quantity) * Number(open.price);
    } else if (trade.usdt) {
      totalNotional += Number(trade.usdt);
    }
  }

  return {
    executed: executed.length,
    blocked: trades.filter((t) => t.status === "skipped").length,
    errors: trades.filter((t) => t.status === "error").length,
    totalNotional: roundUsd(totalNotional),
    buyCount: executed.filter((t) => t.signal === "buy").length,
    sellCount: executed.filter((t) => t.signal === "sell").length,
  };
}

async function getPnLReport(settings, { days = 30 } = {}) {
  const periodDays = Math.min(90, Math.max(1, Number(days) || 30));
  const startTime = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const coins = await getActiveCoins();
  const trades = await listTrades(200);
  const periodTrades = trades.filter((t) => new Date(t.at).getTime() >= startTime);
  const local = localTradeStats(periodTrades);

  const report = {
    days: periodDays,
    startAt: new Date(startTime).toISOString(),
    endAt: new Date().toISOString(),
    source: "local",
    connected: false,
    local,
    summary: {
      realizedPnl: 0,
      commission: 0,
      netPnl: 0,
      unrealizedPnl: 0,
      walletBalance: null,
      availableBalance: null,
      closedEvents: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      openPositions: 0,
    },
    byDay: [],
    bySymbol: [],
    events: [],
    openPositions: [],
    journalTrades: periodTrades,
  };

  if (!settings?.binanceApiKey || !settings?.binanceApiSecret) {
    report.message = "Connect Binance API keys in Settings to load profit & loss from your account.";
    return report;
  }

  try {
    const [account, income, positions] = await Promise.all([
      fetchAccountSnapshot(settings),
      fetchIncomeHistory(settings, { startTime }),
      fetchOpenPositions(settings),
    ]);

    const incomeAgg = aggregateIncome(income, coins);
    const unrealizedPnl = positions.reduce(
      (sum, p) => sum + Number(p.unRealizedProfit || 0),
      0
    );

    report.source = "binance";
    report.connected = true;
    report.summary = {
      realizedPnl: incomeAgg.realizedPnl,
      commission: incomeAgg.commission,
      netPnl: incomeAgg.netPnl,
      unrealizedPnl: roundUsd(unrealizedPnl),
      walletBalance: roundUsd(Number(account.totalWalletBalance || 0)),
      availableBalance: roundUsd(Number(account.availableBalance || 0)),
      closedEvents: incomeAgg.closedEvents,
      wins: incomeAgg.wins,
      losses: incomeAgg.losses,
      winRate: incomeAgg.winRate,
      openPositions: positions.filter((p) => Math.abs(Number(p.positionAmt)) > 0).length,
    };
    report.byDay = incomeAgg.byDay;
    report.bySymbol = incomeAgg.bySymbol;
    report.events = incomeAgg.events;
    report.openPositions = positions
      .filter((p) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p) => ({
        symbol: p.symbol,
        coinId: symbolToCoinId(p.symbol, coins),
        side: Number(p.positionAmt) > 0 ? "LONG" : "SHORT",
        size: Math.abs(Number(p.positionAmt)),
        entryPrice: roundUsd(Number(p.entryPrice || 0)),
        markPrice: roundUsd(Number(p.markPrice || 0)),
        unrealizedPnl: roundUsd(Number(p.unRealizedProfit || 0)),
        leverage: Number(p.leverage || 0),
      }));
    report.testnet = Boolean(settings.binanceTestnet);
  } catch (err) {
    report.connected = false;
    report.error = err.message;
    report.message = `Could not load P&L from Binance: ${err.message}`;
  }

  return report;
}

module.exports = { getPnLReport, roundUsd };
