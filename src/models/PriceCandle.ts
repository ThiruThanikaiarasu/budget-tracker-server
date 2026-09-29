import mongoose, { Schema, Document } from "mongoose";

/**
 * One OHLC candle for a symbol at a given interval. This is our OWN store of
 * market history — metrics (high52, SMAs) are computed from these rows, so the
 * app never depends on any single provider being live. Candles from multiple
 * free sources merge cleanly: the (symbol, exchange, interval, date) unique
 * index dedupes, and `source` records where each row came from.
 *
 * Tiered retention (enforced by the sync scripts, not the schema):
 *   day   → rolling ~18 months  (feeds sma50/sma200, 52w high/low)
 *   week  → ~5 years            (long-term trend)
 *   month → optional, long-horizon context
 */
export type CandleInterval = "day" | "week" | "month";
export type CandleExchange = "NSE" | "BSE";

export interface IPriceCandle extends Document {
  symbol: string;
  exchange: CandleExchange;
  interval: CandleInterval;
  date: string; // YYYY-MM-DD (candle's period start, in IST)
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  source: string; // e.g. "yahoo", "bhavcopy", "nseindia", "twelvedata"
  fetchedAt: Date;
}

const priceCandleSchema = new Schema<IPriceCandle>({
  symbol: { type: String, required: true, uppercase: true, trim: true },
  exchange: { type: String, enum: ["NSE", "BSE"], required: true, default: "NSE" },
  interval: { type: String, enum: ["day", "week", "month"], required: true },
  date: { type: String, required: true },
  open: Number,
  high: Number,
  low: Number,
  close: { type: Number, required: true },
  volume: Number,
  source: { type: String, required: true },
  fetchedAt: { type: Date, default: Date.now },
});

// One candle per (symbol, exchange, interval, date) — dedupes reruns & sources.
priceCandleSchema.index(
  { symbol: 1, exchange: 1, interval: 1, date: 1 },
  { unique: true }
);

export const PriceCandle = mongoose.model<IPriceCandle>(
  "PriceCandle",
  priceCandleSchema
);
