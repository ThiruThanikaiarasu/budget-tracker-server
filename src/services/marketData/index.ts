import { PriceCandle, type CandleInterval, type CandleExchange } from "../../models/PriceCandle.js";
import { StockAnalysis } from "../../models/StockAnalysis.js";
import type { PriceProvider, ProviderCandle, ProviderQuote } from "./types.js";
import { yahooProvider } from "./yahooProvider.js";

/**
 * MarketData: the "many free sources, no single source of truth" layer.
 * Providers are tried in priority order; the first that returns data wins, and
 * every stored candle is tagged with its `source`. Phase 1 ships Yahoo only;
 * Bhavcopy / NSE-lib / TwelveData slot in here later with no caller changes.
 */
const PROVIDERS: PriceProvider[] = [yahooProvider];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Try each provider in order; return the first non-null quote. */
export async function getQuote(
  symbol: string,
  exchange: CandleExchange
): Promise<{ quote: ProviderQuote; source: string } | null> {
  for (const p of PROVIDERS) {
    try {
      const quote = await p.getQuote(symbol, exchange);
      if (quote) return { quote, source: p.name };
    } catch (err) {
      console.warn(`  [${p.name}] quote ${symbol} failed: ${(err as Error).message}`);
    }
  }
  return null;
}

/** Try each provider in order; return the first non-empty candle set. */
export async function getCandles(
  symbol: string,
  exchange: CandleExchange,
  interval: CandleInterval,
  from: Date,
  to: Date
): Promise<{ candles: ProviderCandle[]; source: string } | null> {
  for (const p of PROVIDERS) {
    try {
      const candles = await p.getCandles(symbol, exchange, interval, from, to);
      if (candles && candles.length) return { candles, source: p.name };
    } catch (err) {
      console.warn(`  [${p.name}] candles ${symbol} failed: ${(err as Error).message}`);
    }
  }
  return null;
}

/**
 * Upsert candles into PriceCandle. Higher-priority sources overwrite the same
 * (symbol, exchange, interval, date); a lower-priority source only fills a gap.
 * Returns how many rows were written/updated.
 */
export async function storeCandles(
  symbol: string,
  exchange: CandleExchange,
  interval: CandleInterval,
  candles: ProviderCandle[],
  source: string
): Promise<number> {
  if (!candles.length) return 0;
  const now = new Date();
  const ops = candles.map((c) => ({
    updateOne: {
      filter: { symbol: symbol.toUpperCase(), exchange, interval, date: c.date },
      update: {
        $set: {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          source,
          fetchedAt: now,
        },
      },
      upsert: true,
    },
  }));
  const res = await PriceCandle.bulkWrite(ops, { ordered: false });
  return (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
}

/** Simple moving average of the last `n` closes, or undefined if too few. */
function sma(closes: number[], n: number): number | undefined {
  if (closes.length < n) return undefined;
  const slice = closes.slice(-n);
  return round2(slice.reduce((a, b) => a + b, 0) / n);
}

export interface ComputedMetrics {
  currentPrice?: number;
  high52?: number;
  low52?: number;
  sma50?: number;
  sma200?: number;
  candleCount: number;
}

/**
 * Recompute derived metrics for a symbol from our STORED daily candles (last
 * ~1 year for the 52w window) and upsert them into StockAnalysis — the doc the
 * wishlist strategy evaluator reads. Nested $set so we never wipe any other
 * fundamentals that might exist on the doc.
 */
export async function recomputeMetrics(
  symbol: string,
  exchange: CandleExchange,
  opts: { name?: string; livePrice?: number; source?: string } = {}
): Promise<ComputedMetrics> {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const fromISO = oneYearAgo.toISOString().slice(0, 10);

  const candles = await PriceCandle.find({
    symbol: symbol.toUpperCase(),
    exchange,
    interval: "day",
    date: { $gte: fromISO },
  }).sort({ date: 1 });

  const closes = candles.map((c) => c.close).filter((n) => Number.isFinite(n));
  const highs = candles.map((c) => c.high ?? c.close).filter((n) => Number.isFinite(n));
  const lows = candles.map((c) => c.low ?? c.close).filter((n) => Number.isFinite(n));

  const metrics: ComputedMetrics = {
    currentPrice: opts.livePrice ?? closes[closes.length - 1],
    high52: highs.length ? round2(Math.max(...highs)) : undefined,
    low52: lows.length ? round2(Math.min(...lows)) : undefined,
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    candleCount: candles.length,
  };

  const set: Record<string, unknown> = {
    name: opts.name ?? symbol.toUpperCase(),
    source: opts.source ?? "marketdata",
    fetchedAt: new Date(),
  };
  if (metrics.currentPrice != null) set.currentPrice = metrics.currentPrice;
  if (metrics.high52 != null) set["fundamentals.high52"] = metrics.high52;
  if (metrics.low52 != null) set["fundamentals.low52"] = metrics.low52;
  if (metrics.sma50 != null) set["fundamentals.sma50"] = metrics.sma50;
  if (metrics.sma200 != null) set["fundamentals.sma200"] = metrics.sma200;

  await StockAnalysis.findOneAndUpdate(
    { symbol: symbol.toUpperCase(), exchange },
    { $set: set },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return metrics;
}

/** Delete day candles older than `months` for a symbol (retention pruning). */
export async function pruneCandles(
  symbol: string,
  exchange: CandleExchange,
  interval: CandleInterval,
  months: number
): Promise<number> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const res = await PriceCandle.deleteMany({
    symbol: symbol.toUpperCase(),
    exchange,
    interval,
    date: { $lt: cutoff.toISOString().slice(0, 10) },
  });
  return res.deletedCount ?? 0;
}
