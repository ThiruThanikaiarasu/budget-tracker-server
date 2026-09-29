import type { Request, Response } from "express";
import { Watchlist, type IWatchlistItem } from "../models/Watchlist.js";
import { Strategy, type IStrategy } from "../models/Strategy.js";
import { Domain, type IDomain } from "../models/Domain.js";
import { StrategyDomain } from "../models/StrategyDomain.js";
import { StockAnalysis, type IFundamentals } from "../models/StockAnalysis.js";
import {
  evaluateExpression,
  aggregate,
  type StrategyStatus,
} from "../services/strategyEvaluator.js";

/**
 * Build the variable scope for one wishlist item: live price + cached
 * fundamentals + the item's own target. Only finite numbers are included; a
 * missing metric simply isn't in scope, so any formula that needs it resolves
 * to "no data" rather than a wrong verdict.
 */
function buildMetricScope(
  item: IWatchlistItem,
  analysis: { currentPrice?: number; fundamentals?: IFundamentals } | undefined
): Record<string, number> {
  const scope: Record<string, number> = {};
  const put = (key: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) scope[key] = value;
  };

  const price = item.lastPrice ?? analysis?.currentPrice;
  put("price", price);
  put("currentPrice", price);
  put("targetBuyPrice", item.targetBuyPrice);

  const f = analysis?.fundamentals ?? {};
  for (const key of [
    "marketCap",
    "pe",
    "pb",
    "bookValue",
    "eps",
    "roe",
    "roce",
    "dividendYield",
    "faceValue",
    "high52",
    "low52",
    "debtToEquity",
    "sma50",
    "sma200",
  ]) {
    put(key, (f as Record<string, unknown>)[key]);
  }
  return scope;
}

/**
 * Evaluate every strategy hooked to a wishlist item's domains and return the
 * green/red verdicts + aggregate. Purely descriptive — no buy recommendation.
 *
 * When one strategy is linked to several of an item's domains (e.g. both "stock"
 * and its sector), the more specific sector link wins so its params apply.
 */
export async function analyzeWatchlist(req: Request, res: Response): Promise<void> {
  const watchlist = await Watchlist.findOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!watchlist) {
    res.status(404).json({ success: false, message: "Watchlist not found." });
    return;
  }

  const [strategies, domains, links] = await Promise.all([
    Strategy.find({ userId: req.userId }),
    Domain.find({ userId: req.userId }),
    StrategyDomain.find({ userId: req.userId, enabled: true }),
  ]);

  const strategyById = new Map<string, IStrategy>(
    strategies.map((s) => [String(s._id), s])
  );
  const domainById = new Map<string, IDomain>(
    domains.map((d) => [String(d._id), d])
  );

  // Cached fundamentals for every symbol on the list (one query).
  const analyses = await StockAnalysis.find({
    $or: watchlist.items.map((i) => ({
      symbol: i.symbol.toUpperCase(),
      exchange: i.exchange,
    })),
  });
  const analysisByKey = new Map(
    analyses.map((a) => [`${a.symbol.toUpperCase()}:${a.exchange}`, a])
  );

  const items = watchlist.items.map((item) => {
    const itemDomainIds = new Set((item.domainIds ?? []).map((id) => String(id)));
    const analysis = analysisByKey.get(
      `${item.symbol.toUpperCase()}:${item.exchange}`
    );
    const scope = buildMetricScope(item, analysis);

    // Pick, per strategy, the best link among the item's domains (sector first).
    const chosen = new Map<string, (typeof links)[number]>();
    for (const link of links) {
      if (!itemDomainIds.has(String(link.domainId))) continue;
      const strategy = strategyById.get(String(link.strategyId));
      if (!strategy || !strategy.enabled) continue;
      const existing = chosen.get(String(link.strategyId));
      const isSector = domainById.get(String(link.domainId))?.kind === "sector";
      const existingIsSector =
        existing && domainById.get(String(existing.domainId))?.kind === "sector";
      if (!existing || (isSector && !existingIsSector)) {
        chosen.set(String(link.strategyId), link);
      }
    }

    const results = [...chosen.values()].map((link) => {
      const strategy = strategyById.get(String(link.strategyId))!;
      const domain = domainById.get(String(link.domainId));
      const params = Object.fromEntries(link.params ?? new Map());
      const { status, missing, value } = evaluateExpression(strategy.expression, {
        ...scope,
        ...params,
      });
      return {
        strategyId: String(strategy._id),
        name: strategy.name,
        expression: strategy.expression,
        domainId: String(link.domainId),
        domainName: domain?.name,
        status,
        missing,
        value,
      };
    });

    const summary = aggregate(results.map((r) => r.status as StrategyStatus));
    return {
      _id: String(item._id),
      symbol: item.symbol,
      exchange: item.exchange,
      name: item.name,
      lastPrice: item.lastPrice,
      targetBuyPrice: item.targetBuyPrice,
      domainIds: [...itemDomainIds],
      results,
      summary,
    };
  });

  res.status(200).json({
    success: true,
    watchlistId: String(watchlist._id),
    items,
  });
}
