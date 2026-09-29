import mongoose, { Schema, Document } from "mongoose";

/**
 * The n:m link between a Strategy and a Domain. Crucially it is NOT just a
 * connection — it carries `params`: the per-domain values the strategy's formula
 * references. This is how the SAME strategy evaluates differently per domain/sector
 * (e.g. "price < high52 / divisor" with divisor=2 for stocks but 1.5 for gold).
 * Param keys are merged into the evaluation scope, so they can be referenced by
 * name in the strategy's expression.
 */
export interface IStrategyDomain extends Document {
  userId: mongoose.Types.ObjectId;
  strategyId: mongoose.Types.ObjectId;
  domainId: mongoose.Types.ObjectId;
  params: Map<string, number>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const strategyDomainSchema = new Schema<IStrategyDomain>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    strategyId: {
      type: Schema.Types.ObjectId,
      ref: "Strategy",
      required: true,
    },
    domainId: {
      type: Schema.Types.ObjectId,
      ref: "Domain",
      required: true,
    },
    params: { type: Map, of: Number, default: {} },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One link per (strategy, domain) pair for a user.
strategyDomainSchema.index(
  { userId: 1, strategyId: 1, domainId: 1 },
  { unique: true }
);

export const StrategyDomain = mongoose.model<IStrategyDomain>(
  "StrategyDomain",
  strategyDomainSchema
);
