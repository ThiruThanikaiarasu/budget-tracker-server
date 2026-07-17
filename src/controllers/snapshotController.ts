import type { Request, Response } from "express";
import { Investment } from "../models/Investment.js";
import { PortfolioSnapshot } from "../models/PortfolioSnapshot.js";
import { createSnapshotForUser } from "../services/snapshotService.js";
import { env } from "../config/env.js";

/**
 * List a user's snapshots (oldest first) for the value-over-time chart.
 * Optional ?cadence=weekly|monthly filter.
 */
export async function getSnapshots(req: Request, res: Response): Promise<void> {
  const { cadence } = req.query;
  const filter: Record<string, unknown> = { userId: req.userId };
  if (cadence === "weekly" || cadence === "monthly" || cadence === "manual") {
    filter.cadence = cadence;
  }

  const snapshots = await PortfolioSnapshot.find(filter).sort({ date: 1 });
  res.status(200).json({ success: true, snapshots });
}

/** Take a manual snapshot of the user's current portfolio. */
export async function createSnapshot(req: Request, res: Response): Promise<void> {
  const snapshot = await createSnapshotForUser(req.userId!, "manual");
  res.status(201).json({ success: true, snapshot });
}

/**
 * Cron endpoint (Vercel Cron) — snapshots every user who holds investments.
 * Guarded by CRON_SECRET; not user-authenticated. ?cadence=weekly|monthly.
 */
export async function runScheduledSnapshots(
  req: Request,
  res: Response
): Promise<void> {
  if (env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${env.CRON_SECRET}`) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
  }

  const cadence = req.query.cadence === "monthly" ? "monthly" : "weekly";

  const userIds = await Investment.distinct("userId", { isActive: true });
  let count = 0;
  for (const userId of userIds) {
    await createSnapshotForUser(userId, cadence);
    count++;
  }

  res.status(200).json({ success: true, cadence, snapshotted: count });
}
