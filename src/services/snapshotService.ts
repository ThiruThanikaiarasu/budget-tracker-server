import mongoose from "mongoose";
import { Investment } from "../models/Investment.js";
import {
  PortfolioSnapshot,
  type SnapshotCadence,
  type ISnapshotHolding,
} from "../models/PortfolioSnapshot.js";

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

interface SnapshotOptions {
  benchmarkSymbol?: string;
  benchmarkLevel?: number;
  date?: Date;
}

/**
 * Build and persist a portfolio snapshot for a user from their currently active
 * investments. Idempotent per (user, cadence, day): a same-day snapshot of the
 * same cadence is overwritten rather than duplicated.
 */
export async function createSnapshotForUser(
  userId: mongoose.Types.ObjectId | string,
  cadence: SnapshotCadence,
  opts: SnapshotOptions = {}
) {
  const active = await Investment.find({ userId, isActive: true });

  const holdings: ISnapshotHolding[] = active.map((i) => ({
    name: i.name,
    symbol: i.symbol,
    type: i.type,
    sector: i.sector,
    invested: i.amountInvested,
    current: i.currentValue,
  }));

  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0);
  const totalCurrent = holdings.reduce((s, h) => s + h.current, 0);

  const day = startOfDay(opts.date ?? new Date());

  const fields = {
    userId,
    date: day,
    cadence,
    totalInvested,
    totalCurrent,
    holdings,
    benchmarkSymbol: opts.benchmarkSymbol,
    benchmarkLevel: opts.benchmarkLevel,
  };

  // Overwrite a same-day snapshot of this cadence if one exists.
  const snapshot = await PortfolioSnapshot.findOneAndUpdate(
    { userId, cadence, date: day },
    fields,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return snapshot;
}
