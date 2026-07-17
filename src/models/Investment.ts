import mongoose, { Schema, Document } from "mongoose";

export type InvestmentType =
  | "stocks"
  | "index_fund"
  | "mutual_fund"
  | "us_stock"
  | "bond"
  | "fd"
  | "ppf"
  | "gold"
  | "real_estate"
  | "crypto"
  | "other";

export type Exchange = "NSE" | "BSE" | "NASDAQ" | "NYSE" | "other";

export interface IInvestment extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  type: InvestmentType;
  // Holdings-mode fields (optional; present for market instruments)
  symbol?: string;
  exchange?: Exchange;
  sector?: string;
  quantity?: number;
  avgBuyPrice?: number;
  currentPrice?: number;
  currency: string;
  // Denormalised amounts — derived from qty*price in holdings mode,
  // entered directly in lump-sum mode.
  amountInvested: number;
  currentValue: number;
  dateInvested: Date;
  note?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const investmentTypes: InvestmentType[] = [
  "stocks",
  "index_fund",
  "mutual_fund",
  "us_stock",
  "bond",
  "fd",
  "ppf",
  "gold",
  "real_estate",
  "crypto",
  "other",
];

const investmentSchema = new Schema<IInvestment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: investmentTypes,
    },
    symbol: {
      type: String,
      trim: true,
      uppercase: true,
    },
    exchange: {
      type: String,
      enum: ["NSE", "BSE", "NASDAQ", "NYSE", "other"],
    },
    sector: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      min: 0,
    },
    avgBuyPrice: {
      type: Number,
      min: 0,
    },
    currentPrice: {
      type: Number,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    amountInvested: {
      type: Number,
      required: true,
      min: 0,
    },
    currentValue: {
      type: Number,
      required: true,
      min: 0,
    },
    dateInvested: {
      type: Date,
      required: true,
    },
    note: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const Investment = mongoose.model<IInvestment>(
  "Investment",
  investmentSchema
);
