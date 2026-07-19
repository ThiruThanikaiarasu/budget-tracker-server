import type { Request, Response } from "express";
import { Watchlist } from "../models/Watchlist.js";

/** Max named watchlists a user may keep. */
const MAX_WATCHLISTS = 20;

/** All of the user's watchlists, ordered. */
export async function getWatchlists(req: Request, res: Response): Promise<void> {
  const watchlists = await Watchlist.find({ userId: req.userId }).sort({
    order: 1,
    createdAt: 1,
  });
  res.status(200).json({ success: true, watchlists });
}

/**
 * Create a new named watchlist (capped at MAX_WATCHLISTS).
 * Best-effort cap: the count check and the create aren't atomic, so two
 * concurrent requests right at the limit could land one over. Not worth an
 * atomic guard for a soft UI limit with no financial-integrity impact.
 */
export async function createWatchlist(req: Request, res: Response): Promise<void> {
  const { name, color } = req.body as { name: string; color?: string };

  const count = await Watchlist.countDocuments({ userId: req.userId });
  if (count >= MAX_WATCHLISTS) {
    res.status(400).json({
      success: false,
      message: `Watchlist limit reached (max ${MAX_WATCHLISTS}).`,
    });
    return;
  }

  const watchlist = await Watchlist.create({
    userId: req.userId,
    name,
    color,
    order: count,
  });
  res.status(201).json({ success: true, watchlist });
}

/** Rename / recolor / reorder a watchlist. */
export async function updateWatchlist(req: Request, res: Response): Promise<void> {
  const { name, color, order } = req.body as {
    name?: string;
    color?: string;
    order?: number;
  };

  const watchlist = await Watchlist.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { ...(name !== undefined && { name }), ...(color !== undefined && { color }), ...(order !== undefined && { order }) } },
    { new: true, runValidators: true }
  );

  if (!watchlist) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }
  res.status(200).json({ success: true, watchlist });
}

/** Delete a watchlist and all its items. */
export async function deleteWatchlist(req: Request, res: Response): Promise<void> {
  const result = await Watchlist.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!result) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }
  res.status(200).json({ success: true });
}

/** Add a stock to a watchlist. */
export async function addItem(req: Request, res: Response): Promise<void> {
  const watchlist = await Watchlist.findOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!watchlist) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }

  const { symbol, exchange, name, instrumentToken, targetBuyPrice, notes } =
    req.body as {
      symbol: string;
      exchange: "NSE" | "BSE";
      name: string;
      instrumentToken?: number;
      targetBuyPrice?: number;
      notes?: string;
    };

  watchlist.items.push({
    symbol,
    exchange,
    name,
    instrumentToken,
    targetBuyPrice,
    notes,
  } as never);
  await watchlist.save();

  res.status(201).json({ success: true, watchlist });
}

/** Edit a watchlist item (target price / notes). */
export async function updateItem(req: Request, res: Response): Promise<void> {
  const watchlist = await Watchlist.findOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!watchlist) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }

  const item = watchlist.items.id(req.params.itemId as string);
  if (!item) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }

  const { targetBuyPrice, notes, name } = req.body as {
    targetBuyPrice?: number;
    notes?: string;
    name?: string;
  };
  if (targetBuyPrice !== undefined) item.targetBuyPrice = targetBuyPrice;
  if (notes !== undefined) item.notes = notes;
  if (name !== undefined) item.name = name;

  await watchlist.save();
  res.status(200).json({ success: true, watchlist });
}

/** Remove a stock from a watchlist. */
export async function removeItem(req: Request, res: Response): Promise<void> {
  const watchlist = await Watchlist.findOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!watchlist) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }

  const item = watchlist.items.id(req.params.itemId as string);
  if (!item) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }
  item.deleteOne();
  await watchlist.save();

  res.status(200).json({ success: true, watchlist });
}

/**
 * Bulk-refresh last prices by symbol across all of the user's watchlists.
 * Fed by the Claude/Kite price-refresh command (mirrors the /sync-portfolio flow).
 */
export async function updatePrices(req: Request, res: Response): Promise<void> {
  const { prices } = req.body as {
    prices: { symbol: string; exchange?: string; price: number }[];
  };

  // Prefer an exact symbol+exchange match (NSE:RELIANCE and BSE:RELIANCE are
  // different listings, often at different prices). Fall back to symbol-only
  // for callers that don't disambiguate exchange.
  const bySymbolExchange = new Map<string, number>();
  const bySymbolOnly = new Map<string, number>();
  for (const p of prices) {
    const symbol = p.symbol.toUpperCase();
    if (p.exchange) {
      bySymbolExchange.set(`${symbol}:${p.exchange.toUpperCase()}`, p.price);
    } else {
      bySymbolOnly.set(symbol, p.price);
    }
  }

  const watchlists = await Watchlist.find({ userId: req.userId });
  const now = new Date();
  let updated = 0;

  for (const wl of watchlists) {
    let dirty = false;
    for (const item of wl.items) {
      const symbol = item.symbol.toUpperCase();
      const price =
        bySymbolExchange.get(`${symbol}:${item.exchange.toUpperCase()}`) ??
        bySymbolOnly.get(symbol);
      if (price !== undefined) {
        item.lastPrice = price;
        item.lastPriceAt = now;
        dirty = true;
        updated += 1;
      }
    }
    if (dirty) await wl.save();
  }

  res.status(200).json({ success: true, updated });
}
