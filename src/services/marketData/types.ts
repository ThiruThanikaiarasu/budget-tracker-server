import type { CandleInterval, CandleExchange } from "../../models/PriceCandle.js";

/** A single OHLC bar returned by a provider (source-agnostic shape). */
export interface ProviderCandle {
  date: string; // YYYY-MM-DD
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

/** A spot quote plus any derived metrics a provider hands us for free. */
export interface ProviderQuote {
  price: number;
  currency?: string;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
}

/**
 * A free market-data source. Providers return `null` (not throw) on a clean
 * "no data / unavailable" so the MarketData service can fall through to the
 * next provider. They may throw on unexpected errors — the service catches.
 */
export interface PriceProvider {
  readonly name: string;
  getQuote(symbol: string, exchange: CandleExchange): Promise<ProviderQuote | null>;
  getCandles(
    symbol: string,
    exchange: CandleExchange,
    interval: CandleInterval,
    from: Date,
    to: Date
  ): Promise<ProviderCandle[] | null>;
}
