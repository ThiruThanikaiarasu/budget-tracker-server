import type { Request, Response } from "express";
import { TargetAllocation } from "../models/TargetAllocation.js";

/** Get the user's target allocation (empty targets if never set). */
export async function getTargets(req: Request, res: Response): Promise<void> {
  const doc = await TargetAllocation.findOne({ userId: req.userId });
  res.status(200).json({ success: true, targets: doc?.targets ?? [] });
}

/** Create or replace the user's target allocation. Editable anytime. */
export async function updateTargets(req: Request, res: Response): Promise<void> {
  const { targets } = req.body as { targets: { type: string; pct: number }[] };

  // Mirrors the client's own rule (TargetAllocationPanel) so a direct API call
  // can't store an allocation that doesn't sum to 100%, which would silently
  // skew every rebalancing-gap calculation downstream.
  const sum = targets.reduce((s, t) => s + t.pct, 0);
  if (targets.length > 0 && Math.round(sum) !== 100) {
    res.status(400).json({
      success: false,
      message: `Target allocations must sum to 100% (got ${Math.round(sum)}%).`,
    });
    return;
  }

  const doc = await TargetAllocation.findOneAndUpdate(
    { userId: req.userId },
    { targets },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  res.status(200).json({ success: true, targets: doc.targets });
}
