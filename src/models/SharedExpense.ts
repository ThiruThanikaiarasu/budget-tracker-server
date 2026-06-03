import mongoose, { Schema, Document } from "mongoose";

export interface ISplit {
  friendId: mongoose.Types.ObjectId;
  amount: number;
}

export interface ISharedExpense extends Document {
  userId: mongoose.Types.ObjectId;
  // Set when this split was auto-created from a Transaction; links the two so
  // the transaction can be edited together with its split. Absent for splits
  // added directly via the shared-expense flow.
  transactionId?: mongoose.Types.ObjectId;
  description: string;
  totalAmount: number;
  paidBy: "user" | mongoose.Types.ObjectId;
  date: Date;
  splits: ISplit[];
  isSettlement: boolean;
  createdAt: Date;
}

const sharedExpenseSchema = new Schema<ISharedExpense>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paidBy: {
      type: Schema.Types.Mixed,
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    splits: [
      {
        friendId: {
          type: Schema.Types.ObjectId,
          ref: "Friend",
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],
    isSettlement: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const SharedExpense = mongoose.model<ISharedExpense>(
  "SharedExpense",
  sharedExpenseSchema
);
