import mongoose, { Schema, Document } from "mongoose";
import type { InvestmentType } from "./Investment.js";

export interface IInvestedEntry {
  type: InvestmentType;
  amount: number;
}

export interface IMonthlyInvestmentBudget extends Document {
  userId: mongoose.Types.ObjectId;
  month: string; // YYYY-MM
  budget: number;
  invested: IInvestedEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const investedEntrySchema = new Schema<IInvestedEntry>(
  {
    type: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const monthlyInvestmentBudgetSchema = new Schema<IMonthlyInvestmentBudget>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    month: { type: String, required: true },
    budget: { type: Number, required: true, min: 0, default: 0 },
    invested: { type: [investedEntrySchema], default: [] },
  },
  { timestamps: true }
);

// One record per user per calendar month (keeps history).
monthlyInvestmentBudgetSchema.index({ userId: 1, month: 1 }, { unique: true });

export const MonthlyInvestmentBudget = mongoose.model<IMonthlyInvestmentBudget>(
  "MonthlyInvestmentBudget",
  monthlyInvestmentBudgetSchema
);
