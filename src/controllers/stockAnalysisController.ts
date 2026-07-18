import type { Request, Response } from "express";
import { StockAnalysis } from "../models/StockAnalysis.js";

/** Get stored analysis for a symbol (404 if never analyzed). */
export async function getAnalysis(req: Request, res: Response): Promise<void> {
  const symbol = String(req.params.symbol).toUpperCase();
  const exchange = (req.query.exchange as string) || "NSE";

  const analysis = await StockAnalysis.findOne({ symbol, exchange });
  if (!analysis) {
    res.status(404).json({ success: false, message: "Not analyzed yet." });
    return;
  }
  res.status(200).json({ success: true, analysis });
}

/**
 * Create or refresh a stock's analysis (prices + fundamentals).
 * Written by the Claude analyze command; upserted per (symbol, exchange).
 */
export async function upsertAnalysis(req: Request, res: Response): Promise<void> {
  const { symbol, exchange, name, currentPrice, fundamentals, priceSeries, source } =
    req.body as {
      symbol: string;
      exchange: "NSE" | "BSE";
      name: string;
      currentPrice?: number;
      fundamentals?: Record<string, unknown>;
      priceSeries?: { date: string; close: number }[];
      source?: string;
    };

  const analysis = await StockAnalysis.findOneAndUpdate(
    { symbol: symbol.toUpperCase(), exchange },
    {
      symbol: symbol.toUpperCase(),
      exchange,
      name,
      currentPrice,
      fundamentals: fundamentals ?? {},
      priceSeries: priceSeries ?? [],
      source,
      fetchedAt: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  res.status(200).json({ success: true, analysis });
}
