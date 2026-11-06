import mongoose, { Schema, Document } from "mongoose";

// A named group of related transactions for one month, e.g. "Rent · 2026-11".
// Entries join it through Transaction.tagId. The same name in another month is
// a separate group, so Oct / Nov / Dec rent never run together.
export interface ITagGroup extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  // Lowercased name, so "rent" and "Rent" are the same group.
  normalizedName: string;
  // Calendar month "YYYY-MM" the group belongs to.
  month: string;
  createdAt: Date;
}

const tagGroupSchema = new Schema<ITagGroup>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    normalizedName: { type: String, required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  },
  { timestamps: true }
);

tagGroupSchema.index({ userId: 1, normalizedName: 1, month: 1 }, { unique: true });

export const TagGroup = mongoose.model<ITagGroup>("TagGroup", tagGroupSchema);
