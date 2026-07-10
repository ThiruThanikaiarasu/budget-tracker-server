import mongoose, { Schema, Document } from "mongoose";

export interface IInvestment extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  type:
    | "mutual_fund"
    | "stocks"
    | "fd"
    | "ppf"
    | "gold"
    | "real_estate"
    | "crypto"
    | "other";
  amountInvested: number;
  currentValue: number;
  dateInvested: Date;
  note?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
      enum: [
        "mutual_fund",
        "stocks",
        "fd",
        "ppf",
        "gold",
        "real_estate",
        "crypto",
        "other",
      ],
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
