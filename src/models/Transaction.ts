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
  // Set when a friend paid on behalf of the user; absent when the user paid.
  paidByFriendId?: mongoose.Types.ObjectId;
  // Balance-reconciliation entry ("Clean up · new journey"): adjusts an account
  // to a real balance. Excluded from spend/income/budget reports but still shown
  // in the transaction history.
  isAdjustment?: boolean;
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
      type: Number,
      required: true,
      min: 0,
    },
    personalShare: {
      type: Number,
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
    paidByFriendId: {
      type: Schema.Types.ObjectId,
      ref: "Friend",
    },
    isAdjustment: {
      type: Boolean,
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
