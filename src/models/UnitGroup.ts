import mongoose, { Schema, Document } from "mongoose";

/**
 * A unit inside a group. `factor` converts to the group's base unit
 * (factor 1), e.g. Weight: g = 1, kg = 1000 — so 500 g and 1 kg can be
 * compared (price per kg). `presets` are the quick-pick quantities offered
 * for this unit (items can override them).
 */
export interface IUnit {
  _id: mongoose.Types.ObjectId;
  name: string;
  factor: number;
  presets: number[];
}

/** A kind of measurement — Weight, Volume, Count… — owned by one user. */
export interface IUnitGroup extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  normalizedName: string;
  units: IUnit[];
  createdAt: Date;
  updatedAt: Date;
}

const unitSchema = new Schema<IUnit>({
  name: { type: String, required: true, trim: true },
  factor: { type: Number, required: true, min: 0 },
  presets: { type: [Number], default: [] },
});

const unitGroupSchema = new Schema<IUnitGroup>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true },
    units: { type: [unitSchema], default: [] },
  },
  { timestamps: true }
);

unitGroupSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });

export const UnitGroup = mongoose.model<IUnitGroup>("UnitGroup", unitGroupSchema);

/** Every user starts with these; they're ordinary groups after that. */
export const DEFAULT_UNIT_GROUPS = [
  {
    name: "Weight",
    units: [
      { name: "g", factor: 1, presets: [100, 250, 500] },
      { name: "kg", factor: 1000, presets: [1, 2, 5] },
    ],
  },
  {
    name: "Volume",
    units: [
      { name: "ml", factor: 1, presets: [250, 500] },
      { name: "l", factor: 1000, presets: [1, 2] },
    ],
  },
  {
    name: "Count",
    units: [
      { name: "pcs", factor: 1, presets: [1, 2, 6, 12] },
      { name: "dozen", factor: 12, presets: [1] },
    ],
  },
];
