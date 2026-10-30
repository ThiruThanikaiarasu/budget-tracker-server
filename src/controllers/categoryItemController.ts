import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Category } from "../models/Category.js";
import { Transaction } from "../models/Transaction.js";
import { CategoryItem } from "../models/CategoryItem.js";
import { UnitGroup } from "../models/UnitGroup.js";
import { normalizeName } from "../utils/normalizeName.js";

function duplicateMessage(name: string): string {
  return `"${name}" already exists in this category.`;
}

type MeasurementInput = {
  unitGroupId?: string;
  allowedUnitIds?: string[];
  defaultUnitId?: string;
  defaultQuantity?: number;
  presetOverrides?: { unitId: string; values: number[] }[];
};

/**
 * Check that every unit id belongs to the item's unit group (owned by this
 * user) and return the fields to store. No group = unmeasured item.
 */
async function resolveMeasurement(userId: string, input: MeasurementInput) {
  const { unitGroupId, defaultQuantity } = input;
  if (!unitGroupId) {
    return {
      fields: {
        unitGroupId: undefined, allowedUnitIds: undefined, defaultUnitId: undefined,
        presetOverrides: undefined, defaultQuantity,
      },
    };
  }

  const group = await UnitGroup.findOne({ _id: unitGroupId, userId });
  if (!group) return { error: "Unit group not found." };
  const unitIds = new Set(group.units.map((u) => u._id.toString()));

  const allowed = [...new Set(input.allowedUnitIds ?? [])];
  const overrides = (input.presetOverrides ?? [])
    // An empty list is kept on purpose: "no quick values for this unit".
    .map((o) => ({ unitId: o.unitId, values: [...new Set(o.values.filter((v) => v > 0))].sort((a, b) => a - b) }));
  const referenced = [...allowed, ...overrides.map((o) => o.unitId), ...(input.defaultUnitId ? [input.defaultUnitId] : [])];
  if (referenced.some((id) => !unitIds.has(id))) return { error: "Unit not found in this group." };
  if (input.defaultUnitId && allowed.length > 0 && !allowed.includes(input.defaultUnitId)) {
    return { error: "The default unit must be one of the item's units." };
  }

  return {
    fields: {
      unitGroupId,
      // Empty list = every unit in the group.
      allowedUnitIds: allowed.length > 0 && allowed.length < unitIds.size ? allowed : undefined,
      defaultUnitId: input.defaultUnitId || undefined,
      presetOverrides: overrides.length > 0 ? overrides : undefined,
      defaultQuantity,
    },
  };
}

export async function getCategoryItems(
  req: Request,
  res: Response
): Promise<void> {
  const filter: Record<string, unknown> = { userId: req.userId };
  if (typeof req.query.categoryId === "string") {
    filter.categoryId = req.query.categoryId;
  }

  const items = await CategoryItem.find(filter).sort({ name: 1 });
  res.status(200).json({ success: true, items });
}

export async function createCategoryItem(
  req: Request,
  res: Response
): Promise<void> {
  const { categoryId, name } = req.body;

  const category = await Category.findOne({
    _id: categoryId,
    $or: [{ userId: req.userId }, { userId: null }], // null = shared default category
  });
  if (!category) {
    res.status(404).json({ success: false, message: "Category not found." });
    return;
  }

  const normalizedName = normalizeName(name);
  const existing = await CategoryItem.findOne({
    userId: req.userId,
    categoryId,
    normalizedName,
  });
  if (existing) {
    res.status(409).json({
      success: false,
      message: duplicateMessage(existing.name),
      item: existing,
    });
    return;
  }

  const measurement = await resolveMeasurement(req.userId!, req.body);
  if ("error" in measurement) {
    res.status(400).json({ success: false, message: measurement.error });
    return;
  }

  const item = await CategoryItem.create({
    userId: req.userId,
    categoryId,
    name: name.trim(),
    normalizedName,
    ...measurement.fields,
  });

  res.status(201).json({ success: true, item });
}

export async function updateCategoryItem(
  req: Request,
  res: Response
): Promise<void> {
  const { name } = req.body;

  const item = await CategoryItem.findOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (!item) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }

  const normalizedName = normalizeName(name);
  const clash = await CategoryItem.findOne({
    userId: req.userId,
    categoryId: item.categoryId,
    normalizedName,
    _id: { $ne: item._id },
  });
  if (clash) {
    res
      .status(409)
      .json({ success: false, message: duplicateMessage(clash.name) });
    return;
  }

  const measurement = await resolveMeasurement(req.userId!, req.body);
  if ("error" in measurement) {
    res.status(400).json({ success: false, message: measurement.error });
    return;
  }

  item.name = name.trim();
  item.normalizedName = normalizedName;
  item.set(measurement.fields); // undefined fields are cleared
  item.unit = undefined; // legacy free-text unit is superseded
  await item.save();

  res.status(200).json({ success: true, item });
}

/** Tick/untick "show in picker" for one or many items at once. */
export async function setCategoryItemsVisibility(
  req: Request,
  res: Response
): Promise<void> {
  const { ids, showInPicker } = req.body as { ids: string[]; showInPicker: boolean };

  const result = await CategoryItem.updateMany(
    { _id: { $in: ids }, userId: req.userId },
    { showInPicker }
  );
  if (result.matchedCount !== new Set(ids).size) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }

  res.status(200).json({ success: true });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Purchase summary per item, from the transactions that list it: how many
 * times it was bought, the last purchase, and the average gap between
 * purchases (how long one usually lasts).
 */
export async function getCategoryItemStats(
  req: Request,
  res: Response
): Promise<void> {
  const rows = await Transaction.aggregate<{
    _id: mongoose.Types.ObjectId;
    purchases: { date: Date; amount: number }[];
  }>([
    { $match: { userId: new mongoose.Types.ObjectId(req.userId), "items.itemId": { $exists: true } } },
    { $unwind: "$items" },
    { $match: { "items.itemId": { $ne: null } } },
    { $group: { _id: "$items.itemId", purchases: { $push: { date: "$date", amount: "$items.amount" } } } },
  ]);

  const stats = rows.map(({ _id, purchases }) => {
    const sorted = [...purchases].sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = sorted[sorted.length - 1];
    const gaps = sorted.slice(1).map((p, i) => (p.date.getTime() - sorted[i].date.getTime()) / DAY_MS);
    return {
      itemId: _id,
      count: sorted.length,
      lastDate: last.date,
      lastAmount: last.amount,
      avgIntervalDays: gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    };
  });

  res.status(200).json({ success: true, stats });
}

/** Every purchase of one item, newest first. */
export async function getCategoryItemHistory(
  req: Request,
  res: Response
): Promise<void> {
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }
  const itemId = new mongoose.Types.ObjectId(id);

  const history = await Transaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(req.userId), "items.itemId": itemId } },
    { $unwind: "$items" },
    { $match: { "items.itemId": itemId } },
    { $sort: { date: -1, _id: -1 } },
    {
      $project: {
        _id: 0,
        transactionId: "$_id",
        date: 1,
        quantity: "$items.quantity",
        unit: "$items.unit",
        amount: "$items.amount",
      },
    },
  ]);

  res.status(200).json({ success: true, history });
}

export async function deleteCategoryItem(
  req: Request,
  res: Response
): Promise<void> {
  // Transactions keep their own copy of the item name/qty/price, so deleting
  // an item never changes past records — it only drops it from the picker.
  const result = await CategoryItem.deleteOne({
    _id: req.params.id,
    userId: req.userId,
  });
  if (result.deletedCount === 0) {
    res.status(404).json({ success: false, message: "Item not found." });
    return;
  }

  res.status(200).json({ success: true, message: "Item deleted." });
}
