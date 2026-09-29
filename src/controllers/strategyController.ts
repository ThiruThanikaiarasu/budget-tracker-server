import type { Request, Response } from "express";
import { Strategy } from "../models/Strategy.js";
import { StrategyDomain } from "../models/StrategyDomain.js";
import { parseExpression } from "../services/strategyEvaluator.js";

/** All of the user's strategies, newest first. */
export async function getStrategies(req: Request, res: Response): Promise<void> {
  const strategies = await Strategy.find({ userId: req.userId }).sort({
    createdAt: -1,
  });
  res.status(200).json({ success: true, strategies });
}

/**
 * Create a strategy. The formula is validated by parsing it in the sandbox; an
 * invalid expression is rejected here rather than blowing up at evaluation time.
 * The referenced variable names are derived and stored for the UI to hint at.
 */
export async function createStrategy(req: Request, res: Response): Promise<void> {
  const { name, description, prompt, expression, enabled } = req.body as {
    name: string;
    description?: string;
    prompt?: string;
    expression: string;
    enabled?: boolean;
  };

  let variables: string[];
  try {
    variables = parseExpression(expression);
  } catch (err) {
    res.status(400).json({
      success: false,
      message: `Invalid formula: ${(err as Error).message}`,
    });
    return;
  }

  try {
    const strategy = await Strategy.create({
      userId: req.userId,
      name,
      description,
      prompt,
      expression,
      variables,
      enabled: enabled ?? true,
    });
    res.status(201).json({ success: true, strategy });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res
        .status(409)
        .json({ success: false, message: "A strategy with that name already exists." });
      return;
    }
    throw err;
  }
}

/** Update a strategy. Re-derives `variables` whenever the formula changes. */
export async function updateStrategy(req: Request, res: Response): Promise<void> {
  const { name, description, prompt, expression, enabled } = req.body as {
    name?: string;
    description?: string;
    prompt?: string;
    expression?: string;
    enabled?: boolean;
  };

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (prompt !== undefined) update.prompt = prompt;
  if (enabled !== undefined) update.enabled = enabled;
  if (expression !== undefined) {
    try {
      update.variables = parseExpression(expression);
    } catch (err) {
      res.status(400).json({
        success: false,
        message: `Invalid formula: ${(err as Error).message}`,
      });
      return;
    }
    update.expression = expression;
  }

  const strategy = await Strategy.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!strategy) {
    res.status(404).json({ success: false, message: "Strategy not found." });
    return;
  }
  res.status(200).json({ success: true, strategy });
}

/** Delete a strategy and all of its domain links. */
export async function deleteStrategy(req: Request, res: Response): Promise<void> {
  const strategy = await Strategy.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!strategy) {
    res.status(404).json({ success: false, message: "Strategy not found." });
    return;
  }
  await StrategyDomain.deleteMany({ userId: req.userId, strategyId: strategy._id });
  res.status(200).json({ success: true });
}

/** The domain links (with per-domain params) for one strategy. */
export async function getStrategyLinks(req: Request, res: Response): Promise<void> {
  const links = await StrategyDomain.find({
    userId: req.userId,
    strategyId: req.params.id,
  });
  res.status(200).json({ success: true, links });
}

/**
 * Attach a strategy to a domain (or update the params of an existing link).
 * `params` are the per-domain values the formula references (e.g. { divisor: 2 }).
 */
export async function upsertStrategyLink(req: Request, res: Response): Promise<void> {
  const { params, enabled } = req.body as {
    params?: Record<string, number>;
    enabled?: boolean;
  };

  const link = await StrategyDomain.findOneAndUpdate(
    {
      userId: req.userId,
      strategyId: req.params.id,
      domainId: req.params.domainId,
    },
    {
      $set: {
        ...(params !== undefined && { params }),
        ...(enabled !== undefined && { enabled }),
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  res.status(200).json({ success: true, link });
}

/** Detach a strategy from a domain. */
export async function deleteStrategyLink(req: Request, res: Response): Promise<void> {
  const result = await StrategyDomain.findOneAndDelete({
    userId: req.userId,
    strategyId: req.params.id,
    domainId: req.params.domainId,
  });
  if (!result) {
    res.status(404).json({ success: false, message: "Link not found." });
    return;
  }
  res.status(200).json({ success: true });
}
