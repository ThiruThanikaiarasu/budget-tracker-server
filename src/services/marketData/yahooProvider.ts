import YahooFinance from "yahoo-finance2";
import type { CandleInterval, CandleExchange } from "../../models/PriceCandle.js";
import type { PriceProvider, ProviderCandle, ProviderQuote } from "./types.js";

/**
 * Yahoo Finance provider — keyless, no login. NSE symbols use a `.NS` suffix,
 * BSE `.BO`. Yahoo also returns 52w high/low + 50/200-day averages directly on
 * the quote, which we pass through as a convenience/cross-check (we still
 * compute our own from stored candles as the source of truth).
 *
 * Data note: `chart().quotes[].close` is the UNadjusted close (what the price
 * actually traded at) — the right series for comparing "today vs its 52w high".
 * `adjclose` (dividend-adjusted) is intentionally ignored.
 */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const yahooInterval: Record<CandleInterval, "1d" | "1wk" | "1mo"> = {
  day: "1d",
  week: "1wk",
  month: "1mo",
};

function toYahooSymbol(symbol: string, exchange: CandleExchange): string {
  const suffix = exchange === "BSE" ? ".BO" : ".NS";
  return `${symbol.toUpperCase()}${suffix}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const yahooProvider: PriceProvider = {
  name: "yahoo",

  async getQuote(symbol, exchange): Promise<ProviderQuote | null> {
    const q = await yf.quote(toYahooSymbol(symbol, exchange));
    if (!q || q.regularMarketPrice == null) return null;
    return {
      price: q.regularMarketPrice,
      currency: q.currency,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow,
      fiftyDayAverage: q.fiftyDayAverage,
      twoHundredDayAverage: q.twoHundredDayAverage,
    };
  },

  async getCandles(
    symbol,
    exchange,
    interval,
    from,
    to
  ): Promise<ProviderCandle[] | null> {
    const res = await yf.chart(toYahooSymbol(symbol, exchange), {
      period1: isoDate(from),
      period2: isoDate(to),
      interval: yahooInterval[interval],
    });
    const rows = res?.quotes ?? [];
    const candles: ProviderCandle[] = [];
    for (const r of rows) {
      // Yahoo occasionally yields rows with null OHLC (holidays/partial bars).
      if (!r.date || r.close == null) continue;
      candles.push({
        date: isoDate(r.date),
        open: r.open ?? undefined,
        high: r.high ?? undefined,
        low: r.low ?? undefined,
        close: r.close,
        volume: r.volume ?? undefined,
      });
    }
    return candles.length ? candles : null;
  },
};
