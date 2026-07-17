import mongoose, { Schema, Document } from "mongoose";
import type { InvestmentType } from "./Investment.js";

export type SnapshotCadence = "weekly" | "monthly" | "manual";

export interface ISnapshotHolding {
  name: string;
  symbol?: string;
  type: InvestmentType;
  sector?: string;
  invested: number;
  current: number;
}

export interface IPortfolioSnapshot extends Document {
  userId: mongoose.Types.ObjectId;
  date: Date;
  cadence: SnapshotCadence;
  totalInvested: number;
  totalCurrent: number;
  // Per-holding values so any subset (stock / sector / total) can be
  // reconstructed over time for the Nifty benchmark comparison.
  holdings: ISnapshotHolding[];
  // Benchmark index level captured at snapshot time (e.g. NIFTY 50).
  // Populated by the Zerodha sync; absent on cron/manual snapshots without a sync.
  benchmarkSymbol?: string;
  benchmarkLevel?: number;
  createdAt: Date;
  updatedAt: Date;
}

const holdingSchema = new Schema<ISnapshotHolding>(
  {
    name: { type: String, required: true },
    symbol: { type: String },
    type: { type: String, required: true },
    sector: { type: String },
    invested: { type: Number, required: true },
    current: { type: Number, required: true },
  },
  { _id: false }
);

const snapshotSchema = new Schema<IPortfolioSnapshot>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    date: { type: Date, required: true },
    cadence: {
      type: String,
      required: true,
      enum: ["weekly", "monthly", "manual"],
    },
    totalInvested: { type: Number, required: true },
    totalCurrent: { type: Number, required: true },
    holdings: { type: [holdingSchema], default: [] },
    benchmarkSymbol: { type: String },
    benchmarkLevel: { type: Number },
  },
  { timestamps: true }
);

// One snapshot per user per day per cadence — DB-level guard against duplicates
// even under concurrent triggers. The service upserts on this exact key.
snapshotSchema.index({ userId: 1, cadence: 1, date: 1 }, { unique: true });

export const PortfolioSnapshot = mongoose.model<IPortfolioSnapshot>(
  "PortfolioSnapshot",
  snapshotSchema
);
