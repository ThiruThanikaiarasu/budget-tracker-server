import type { Request, Response } from "express";
import { Domain } from "../models/Domain.js";
import { StrategyDomain } from "../models/StrategyDomain.js";

/** All of the user's domains, ordered. */
export async function getDomains(req: Request, res: Response): Promise<void> {
  const domains = await Domain.find({ userId: req.userId }).sort({
    order: 1,
    createdAt: 1,
  });
  res.status(200).json({ success: true, domains });
}

/** Create a domain (asset class, or a sector nesting under one). */
export async function createDomain(req: Request, res: Response): Promise<void> {
  const { name, kind, parent, color } = req.body as {
    name: string;
    kind?: "asset_class" | "sector";
    parent?: string;
    color?: string;
  };

  try {
    const count = await Domain.countDocuments({ userId: req.userId });
    const domain = await Domain.create({
      userId: req.userId,
      name,
      kind: kind ?? "asset_class",
      parent,
      color,
      order: count,
    });
    res.status(201).json({ success: true, domain });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res
        .status(409)
        .json({ success: false, message: "A domain with that name already exists." });
      return;
    }
    throw err;
  }
}

/** Rename / recolor / re-nest / reorder a domain. */
export async function updateDomain(req: Request, res: Response): Promise<void> {
  const { name, kind, parent, color, order } = req.body as {
    name?: string;
    kind?: "asset_class" | "sector";
    parent?: string | null;
    color?: string;
    order?: number;
  };

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (kind !== undefined) update.kind = kind;
  if (parent !== undefined) update.parent = parent; // null clears nesting
  if (color !== undefined) update.color = color;
  if (order !== undefined) update.order = order;

  const domain = await Domain.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!domain) {
    res.status(404).json({ success: false, message: "Domain not found." });
    return;
  }
  res.status(200).json({ success: true, domain });
}

/** Delete a domain and every strategy link that pointed at it. */
export async function deleteDomain(req: Request, res: Response): Promise<void> {
  const domain = await Domain.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!domain) {
    res.status(404).json({ success: false, message: "Domain not found." });
    return;
  }
  await StrategyDomain.deleteMany({ userId: req.userId, domainId: domain._id });
  res.status(200).json({ success: true });
}
