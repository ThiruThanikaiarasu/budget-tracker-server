import mongoose, { Schema, Document } from "mongoose";

export interface ICategoryBudget {
  categoryId: mongoose.Types.ObjectId;
  limit: number;
  frequency: "daily" | "monthly";
}

export interface IBudget extends Document {
  userId: mongoose.Types.ObjectId;
  month: string; // YYYY-MM
  overallLimit?: number;
  categoryBudgets: ICategoryBudget[];
  createdAt: Date;
  updatedAt: Date;
}

const categoryBudgetSchema = new Schema<ICategoryBudget>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    limit: {
      type: Number,
      required: true,
      min: 0,
    },
    frequency: {
      type: String,
      required: true,
      enum: ["daily", "monthly"],
      default: "daily",
    },
  },
  { _id: false }
);

const budgetSchema = new Schema<IBudget>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },
    overallLimit: {
      type: Number,
      min: 0,
    },
    categoryBudgets: {
      type: [categoryBudgetSchema],
      default: [],
    },
  },
  { timestamps: true }
);

budgetSchema.index({ userId: 1, month: 1 }, { unique: true });

export const Budget = mongoose.model<IBudget>("Budget", budgetSchema);
