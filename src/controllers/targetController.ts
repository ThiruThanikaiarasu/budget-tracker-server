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

  const doc = await TargetAllocation.findOneAndUpdate(
    { userId: req.userId },
    { targets },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  res.status(200).json({ success: true, targets: doc.targets });
}
