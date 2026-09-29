import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Watchlist } from "../models/Watchlist.js";
import type { CandleExchange } from "../models/PriceCandle.js";
import {
  getQuote,
  getCandles,
  storeCandles,
  recomputeMetrics,
  pruneCandles,
} from "../services/marketData/index.js";

/**
 * Sync wishlist price data from free market-data providers (Phase 1: Yahoo).
 * No API key, no login — the whole point of moving wishlist metrics off Kite.
 *
 * Modes:
 *   --backfill : pull ~18 months of daily + ~5 years of weekly candles (one-time
 *                seed). Also prunes day candles older than 18 months.
 *   (default)  : incremental — pull the last ~15 days of daily candles to catch
 *                up, refresh today's quote price.
 * Both then recompute high52/low52/sma50/sma200 into StockAnalysis and refresh
 * each watchlist item's lastPrice.
 *
 * Usage:
 *   npx tsx src/scripts/syncPrices.ts --email=you@mail.com --backfill --apply
 *   npx tsx src/scripts/syncPrices.ts --email=you@mail.com                 # dry-run incremental
 *   npx tsx src/scripts/syncPrices.ts --email=you@mail.com --apply         # incremental write
 */

const APPLY = process.argv.includes("--apply");
const BACKFILL = process.argv.includes("--backfill");
const emailArg = process.argv.find((a) => a.startsWith("--email="));
const EMAIL = emailArg ? emailArg.split("=")[1] : "";

const DAILY_RETENTION_MONTHS = 18;
const WEEKLY_YEARS = 5;
const INCREMENTAL_DAYS = 15;

interface Instrument {
  symbol: string;
  exchange: CandleExchange;
  name: string;
}

async function run(): Promise<void> {
  if (!EMAIL) {
    console.error("Pass --email=<your login email>.");
    process.exit(1);
  }

  await connectDB();
  const user = await User.findOne({ email: EMAIL });
  if (!user) {
    console.error(`No user found with email ${EMAIL}.`);
    process.exit(1);
  }

  // Gather the distinct instruments across the user's watchlists.
  const watchlists = await Watchlist.find({ userId: user._id });
  const instruments = new Map<string, Instrument>();
  for (const wl of watchlists) {
    for (const item of wl.items) {
      const exchange = (item.exchange === "BSE" ? "BSE" : "NSE") as CandleExchange;
      const key = `${item.symbol.toUpperCase()}:${exchange}`;
      if (!instruments.has(key)) {
        instruments.set(key, { symbol: item.symbol.toUpperCase(), exchange, name: item.name });
      }
    }
  }

  if (instruments.size === 0) {
    console.log("No watchlist instruments found. Nothing to sync.");
    process.exit(0);
  }

  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — ${BACKFILL ? "BACKFILL" : "incremental"} sync of ` +
      `${instruments.size} instrument(s) for ${EMAIL}\n`
  );

  const now = new Date();
  const dailyFrom = new Date(now);
  if (BACKFILL) dailyFrom.setMonth(dailyFrom.getMonth() - DAILY_RETENTION_MONTHS);
  else dailyFrom.setDate(dailyFrom.getDate() - INCREMENTAL_DAYS);
  const weeklyFrom = new Date(now);
  weeklyFrom.setFullYear(weeklyFrom.getFullYear() - WEEKLY_YEARS);

  // Latest price per instrument, used to refresh watchlist lastPrice at the end.
  const priceByKey = new Map<string, number>();

  for (const inst of instruments.values()) {
    const { symbol, exchange, name } = inst;
    const q = await getQuote(symbol, exchange);
    const daily = await getCandles(symbol, exchange, "day", dailyFrom, now);
    const weekly = BACKFILL ? await getCandles(symbol, exchange, "week", weeklyFrom, now) : null;

    const livePrice = q?.quote.price;
    if (livePrice != null) priceByKey.set(`${symbol}:${exchange}`, livePrice);

    let storedDay = 0;
    let storedWeek = 0;
    if (APPLY) {
      if (daily) storedDay = await storeCandles(symbol, exchange, "day", daily.candles, daily.source);
      if (weekly) storedWeek = await storeCandles(symbol, exchange, "week", weekly.candles, weekly.source);
    }

    console.log(
      `  ${symbol.padEnd(12)} price ${String(livePrice ?? "—").padEnd(9)} ` +
        `[${q?.source ?? "no quote"}]  day ${daily ? daily.candles.length : 0}` +
        (APPLY ? `→${storedDay}` : "") +
        (BACKFILL ? `  week ${weekly ? weekly.candles.length : 0}${APPLY ? `→${storedWeek}` : ""}` : "")
    );

    if (APPLY) {
      const m = await recomputeMetrics(symbol, exchange, { name, livePrice, source: q?.source });
      console.log(
        `     → high52 ${m.high52 ?? "—"}  low52 ${m.low52 ?? "—"}  ` +
          `sma50 ${m.sma50 ?? "—"}  sma200 ${m.sma200 ?? "—"}  (${m.candleCount} stored day candles)`
      );
      if (BACKFILL) await pruneCandles(symbol, exchange, "day", DAILY_RETENTION_MONTHS);
    }
  }

  // Refresh watchlist item lastPrice from the freshest quote we saw.
  let priced = 0;
  if (APPLY) {
    for (const wl of watchlists) {
      let dirty = false;
      for (const item of wl.items) {
        const exchange = item.exchange === "BSE" ? "BSE" : "NSE";
        const price = priceByKey.get(`${item.symbol.toUpperCase()}:${exchange}`);
        if (price != null) {
          item.lastPrice = price;
          item.lastPriceAt = now;
          dirty = true;
          priced += 1;
        }
      }
      if (dirty) await wl.save();
    }
  }

  console.log(
    APPLY
      ? `\nDone. Recomputed ${instruments.size} instrument(s); priced ${priced} watchlist item(s).\n`
      : `\nDry-run only. Re-run with --apply to store candles + recompute + price.\n`
  );
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
