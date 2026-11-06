import mongoose, { Schema, Document } from "mongoose";

// One priced line of an itemised bill (e.g. Tomato · 1 kg · ₹60). name/unit
// are copied from the CategoryItem at save time so history survives renames
// and deletes of the item.
export interface ITransactionItem {
  itemId?: mongoose.Types.ObjectId;
  name: string;
  quantity?: number;
  unit?: string;
  // Unit id within the item's UnitGroup, and quantity × unit factor in the
  // group's base unit (e.g. 2 kg → 2000) — lets prices be compared per kg.
  unitId?: mongoose.Types.ObjectId;
  baseQuantity?: number;
  amount: number;
  // Category of this line when it differs from the transaction's category
  // (e.g. a Snacks sandwich on a Tea bill). Absent = the transaction's category.
  categoryId?: mongoose.Types.ObjectId;
  // Who shares this item when the bill is split by item: "user" and/or
  // Friend ids. Absent when the transaction isn't split.
  sharedWith?: string[];
}

// Bill-level extra: delivery fee, tax (positive) or discount (negative).
// When split by item, spread across people in proportion to their item totals.
export interface ITransactionCharge {
  label: string;
  amount: number;
  // Category the fee/discount belongs to when it differs from the
  // transaction's. Absent = the transaction's category.
  categoryId?: mongoose.Types.ObjectId;
  // Applies to the whole bill (delivery fee, tax, coupon): spread across the
  // categories in proportion to their amounts. Overrides categoryId.
  bill?: boolean;
}

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
  // Set on an income transaction that a friend sent the user directly (e.g. a
  // gift or reimbursement with no tracked debt). Purely informational — does
  // NOT affect the friend balance/SharedExpense system.
  receivedFromFriendId?: mongoose.Types.ObjectId;
  // "Passed on": someone else's money forwarded to a friend. Who it went to,
  // and who it came from (free text: it needn't be a friend). Informational only;
  // no friend balance moves.
  passedToFriendId?: mongoose.Types.ObjectId;
  passedFrom?: string;
  // Balance-reconciliation entry ("Clean up · new journey"): adjusts an account
  // to a real balance. Excluded from spend/income/budget reports but still shown
  // in the transaction history.
  isAdjustment?: boolean;
  // Itemised breakdown. When present, amount = sum(items) + sum(charges).
  items?: ITransactionItem[];
  charges?: ITransactionCharge[];
  // Where it was bought: Swiggy, Amazon, a hotel's name…
  merchant?: string;
  // Group that ties related entries together across types and accounts (e.g.
  // "Rent · Nov 2026": the cash withdrawals and a friend's share). See TagGroup.
  tagId?: mongoose.Types.ObjectId;
  // Set on entries the recurring service added: "item:<id>" or "category:<id>"
  // and the due date it covers. Unique per source and due date, so running the
  // service twice (cron + app load) can't add the same month twice.
  recurringKey?: string;
  recurringDue?: Date;
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
    receivedFromFriendId: {
      type: Schema.Types.ObjectId,
      ref: "Friend",
    },
    passedToFriendId: {
      type: Schema.Types.ObjectId,
      ref: "Friend",
    },
    passedFrom: {
      type: String,
      trim: true,
    },
    isAdjustment: {
      type: Boolean,
    },
    items: {
      type: [
        {
          _id: false,
          itemId: { type: Schema.Types.ObjectId, ref: "CategoryItem" },
          name: { type: String, required: true, trim: true },
          quantity: { type: Number, min: 0 },
          unit: { type: String, trim: true },
          unitId: { type: Schema.Types.ObjectId },
          baseQuantity: { type: Number, min: 0 },
          amount: { type: Number, required: true, min: 0 },
          categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
          sharedWith: { type: [String], default: undefined },
        },
      ],
      default: undefined,
    },
    charges: {
      type: [
        {
          _id: false,
          label: { type: String, required: true, trim: true },
          amount: { type: Number, required: true },
          categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
          bill: { type: Boolean },
        },
      ],
      default: undefined,
    },
    merchant: {
      type: String,
      trim: true,
    },
    tagId: {
      type: Schema.Types.ObjectId,
      ref: "TagGroup",
      index: true,
    },
    recurringKey: { type: String },
    recurringDue: { type: Date },
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

transactionSchema.index(
  { userId: 1, recurringKey: 1, recurringDue: 1 },
  { unique: true, partialFilterExpression: { recurringKey: { $type: "string" } } }
);

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);
