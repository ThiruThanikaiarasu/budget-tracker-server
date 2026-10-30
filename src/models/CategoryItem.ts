import mongoose, { Schema, Document } from "mongoose";

/**
 * A sub-category under a Category — e.g. "Tomato" / "Potato" under Groceries.
 * A transaction can be broken down into several of these, each with its own
 * price (see `items` on Transaction).
 */
export interface ICategoryItem extends Document {
  userId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  name: string;
  // normalizeName(name) — enforces "Potato" == "potato" == "po tato".
  normalizedName: string;
  // How the item is measured (Weight, Count…). Units below are ids of
  // units inside that group.
  unitGroupId?: mongoose.Types.ObjectId;
  // Units offered for this item (e.g. Tomato: g, kg). Empty = all of the group's.
  allowedUnitIds?: mongoose.Types.ObjectId[];
  // Prefilled into the transaction row when the item is picked (e.g. 500 g).
  defaultUnitId?: mongoose.Types.ObjectId;
  defaultQuantity?: number;
  // Item-specific quick values replacing the group's for that unit
  // (e.g. Saffron → g: [1, 2]).
  presetOverrides?: { unitId: mongoose.Types.ObjectId; values: number[] }[];
  // Legacy free-text unit from before unit groups; migrated on first load
  // of unit groups (see unitGroupController.ensureUnitGroups).
  unit?: string;
  // Listed in the transaction form's item picker. Unticked items stay usable
  // via the picker's search. Missing on older docs = true.
  showInPicker: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categoryItemSchema = new Schema<ICategoryItem>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
    },
    unitGroupId: {
      type: Schema.Types.ObjectId,
      ref: "UnitGroup",
    },
    allowedUnitIds: {
      type: [Schema.Types.ObjectId],
      default: undefined,
    },
    defaultUnitId: {
      type: Schema.Types.ObjectId,
    },
    defaultQuantity: {
      type: Number,
      min: 0,
    },
    presetOverrides: {
      type: [
        {
          _id: false,
          unitId: { type: Schema.Types.ObjectId, required: true },
          values: { type: [Number], default: [] },
        },
      ],
      default: undefined,
    },
    unit: {
      type: String,
      trim: true,
    },
    showInPicker: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

categoryItemSchema.index(
  { userId: 1, categoryId: 1, normalizedName: 1 },
  { unique: true }
);

export const CategoryItem = mongoose.model<ICategoryItem>(
  "CategoryItem",
  categoryItemSchema
);
