import type { Request, Response } from "express";
import { env } from "../config/env.js";
import {
  loadSources,
  runAutopay,
  runAutopayForAll,
} from "../services/recurringService.js";

/** Everything recurring; `due` = an autopay entry is waiting to be added. */
export async function getRecurring(req: Request, res: Response): Promise<void> {
  const now = new Date();
  const sources = await loadSources(req.userId!);
  res.status(200).json({
    success: true,
    recurring: sources.map((s) => {
      const r = s.doc.recurring!;
      return {
        kind: s.kind,
        id: s.doc._id,
        name: s.doc.name,
        amount: r.amount,
        accountId: r.accountId,
        autopay: r.autopay,
        frequency: r.frequency,
        nextDue: r.nextDue,
        due: !!r.autopay && !!r.nextDue && r.nextDue <= now,
      };
    }),
  });
}

/** Add any autopay entries that have fallen due. The app calls this on load. */
export async function runRecurring(req: Request, res: Response): Promise<void> {
  const created = await runAutopay(req.userId!);
  res.status(200).json({ success: true, created });
}

/** Cron endpoint (Vercel Cron), guarded by CRON_SECRET like the snapshot cron. */
export async function runRecurringCron(req: Request, res: Response): Promise<void> {
  if (env.CRON_SECRET && req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const created = await runAutopayForAll();
  res.status(200).json({ success: true, created });
}
