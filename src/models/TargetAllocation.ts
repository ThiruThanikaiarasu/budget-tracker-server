import mongoose, { Schema, Document } from "mongoose";
import type { InvestmentType } from "./Investment.js";

export interface ITargetEntry {
  type: InvestmentType;
  pct: number;
}

export interface ITargetAllocation extends Document {
  userId: mongoose.Types.ObjectId;
  targets: ITargetEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const targetEntrySchema = new Schema<ITargetEntry>(
  {
    type: { type: String, required: true },
    pct: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const targetAllocationSchema = new Schema<ITargetAllocation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    targets: { type: [targetEntrySchema], default: [] },
  },
  { timestamps: true }
);

export const TargetAllocation = mongoose.model<ITargetAllocation>(
  "TargetAllocation",
  targetAllocationSchema
);
