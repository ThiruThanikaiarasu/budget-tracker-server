import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * A "domain" is a bucket that strategies hook onto. Two levels:
 *  - asset_class: "stock", "gold", "nifty" / index_fund, ...
 *  - sector:      "Financial Services", "FMCG", ... (nested under a stock asset class)
 * A wishlist item resolves to one or more domains (its asset class, plus a sector
 * if it's a stock); every strategy linked to those domains is evaluated for it.
 */
export type DomainKind = "asset_class" | "sector";

export interface IDomain extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  kind: DomainKind;
  // For sector domains: the asset_class domain they nest under (usually "stock").
  parent?: Types.ObjectId;
  color?: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const domainSchema = new Schema<IDomain>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ["asset_class", "sector"],
      required: true,
      default: "asset_class",
    },
    parent: { type: Schema.Types.ObjectId, ref: "Domain" },
    color: { type: String },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A user can't have two domains with the same name.
domainSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Domain = mongoose.model<IDomain>("Domain", domainSchema);
