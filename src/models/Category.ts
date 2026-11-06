import mongoose, { Schema, Document } from "mongoose";
import { recurringSubSchema, type IRecurring } from "../utils/recurring.js";

export interface ICategory extends Document {
  userId: mongoose.Types.ObjectId | null;
  name: string;
  type: "income" | "expense";
  icon?: string;
  // Set when this whole category repeats (e.g. Rent). See utils/recurring.ts.
  recurring?: IRecurring;
  createdAt: Date;
}

const categorySchema = new Schema<ICategory>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    default: null,
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
    enum: ["income", "expense"],
  },
  icon: {
    type: String,
    trim: true,
  },
  recurring: {
    type: recurringSubSchema,
    default: undefined,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Category = mongoose.model<ICategory>("Category", categorySchema);
