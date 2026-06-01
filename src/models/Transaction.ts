import mongoose, { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: "income" | "expense" | "transfer";
  amount: number;
  // User's own share of `amount` when this expense was split with friends.
  // Undefined for non-split transactions (the full amount is the user's).
  personalShare?: number;
  categoryId?: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  toAccountId?: mongoose.Types.ObjectId;
  note?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["income", "expense", "transfer"],
    },
    amount: {
      type: Schema.Types.Double,
      required: true,
      min: 0,
    },
    personalShare: {
      type: Schema.Types.Double,
      min: 0,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
    },
    toAccountId: {
      type: Schema.Types.ObjectId,
      ref: "Account",
    },
    note: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);
