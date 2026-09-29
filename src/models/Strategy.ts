import mongoose, { Schema, Document } from "mongoose";

/**
 * A Strategy is a stored, named formula (the user calls this a "factor"/"strategy"
 * interchangeably — it's one concept). It evaluates a wishlist item's live values
 * to a single green (considerable) / red (not) verdict.
 *
 * The formula lives in `expression` as a sandboxed math-expression string, e.g.
 *   "price < high52 / divisor"
 * evaluated with expr-eval against a scope of resolved variables (metrics from
 * StockAnalysis + the item's own fields + per-domain params from StrategyDomain).
 * `prompt` keeps the natural-language definition the user gave, so the expression
 * can be regenerated/edited later. `variables` is auto-derived from the expression.
 */
export interface IStrategy extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  prompt?: string;
  expression: string;
  variables: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const strategySchema = new Schema<IStrategy>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    prompt: { type: String, trim: true },
    expression: { type: String, required: true, trim: true },
    variables: { type: [String], default: [] },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// A user can't have two strategies with the same name.
strategySchema.index({ userId: 1, name: 1 }, { unique: true });

export const Strategy = mongoose.model<IStrategy>("Strategy", strategySchema);
