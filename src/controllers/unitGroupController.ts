import type { Request, Response } from "express";
import mongoose from "mongoose";
import { UnitGroup, DEFAULT_UNIT_GROUPS } from "../models/UnitGroup.js";
import { CategoryItem } from "../models/CategoryItem.js";
import { normalizeName } from "../utils/normalizeName.js";

type UnitInput = { _id?: string; name: string; factor: number; presets?: number[] };

/** Sorted, de-duplicated, positive quick values. */
function cleanPresets(values: number[] | undefined): number[] {
  return [...new Set((values ?? []).filter((v) => v > 0))].sort((a, b) => a - b);
}

/**
 * Seed the default groups for a user who has none, then attach any legacy
 * free-text item units ("kg") to the matching unit. Safe to call repeatedly.
 */
export async function ensureUnitGroups(userId: string) {
  let groups = await UnitGroup.find({ userId }).sort({ createdAt: 1, _id: 1 });
  if (groups.length === 0) {
    try {
      await UnitGroup.insertMany(
        DEFAULT_UNIT_GROUPS.map((g) => ({
          userId,
          name: g.name,
          normalizedName: normalizeName(g.name),
          units: g.units,
        })),
        { ordered: false }
      );
    } catch (err) {
      // A concurrent first request already seeded them (unique index).
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    groups = await UnitGroup.find({ userId }).sort({ createdAt: 1, _id: 1 });
  }

  const legacy = await CategoryItem.find({
    userId,
    unit: { $exists: true, $ne: "" },
    unitGroupId: { $exists: false },
  });
  for (const item of legacy) {
    const key = normalizeName(item.unit!);
    for (const group of groups) {
      const unit = group.units.find((u) => normalizeName(u.name) === key);
      if (unit) {
        item.unitGroupId = group._id as mongoose.Types.ObjectId;
        item.defaultUnitId = unit._id;
        item.unit = undefined;
        await item.save();
        break;
      }
    }
  }

  return groups;
}

/** Validates name/units; returns an error message or the cleaned units. */
function validateUnits(
  units: UnitInput[],
  existing: { _id: mongoose.Types.ObjectId }[] = []
): { error: string } | { units: UnitInput[] } {
  if (units.length === 0) return { error: "Add at least one unit." };
  const seen = new Set<string>();
  for (const u of units) {
    const key = normalizeName(u.name);
    if (seen.has(key)) return { error: `Unit "${u.name}" is listed twice.` };
    seen.add(key);
  }
  const existingIds = new Set(existing.map((u) => u._id.toString()));
  return {
    units: units.map((u) => ({
      // Keep ids of units that already exist so items referencing them survive a rename.
      ...(u._id && existingIds.has(u._id) ? { _id: u._id } : {}),
      name: u.name.trim(),
      factor: u.factor,
      presets: cleanPresets(u.presets),
    })),
  };
}

async function duplicateGroupName(userId: string, name: string, excludeId?: string) {
  return UnitGroup.findOne({
    userId,
    normalizedName: normalizeName(name),
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
}

export async function getUnitGroups(req: Request, res: Response): Promise<void> {
  const groups = await ensureUnitGroups(req.userId!);
  res.status(200).json({ success: true, groups });
}

export async function createUnitGroup(req: Request, res: Response): Promise<void> {
  const { name, units } = req.body as { name: string; units: UnitInput[] };

  const clash = await duplicateGroupName(req.userId!, name);
  if (clash) {
    res.status(409).json({ success: false, message: `"${clash.name}" already exists.` });
    return;
  }
  const checked = validateUnits(units);
  if ("error" in checked) {
    res.status(400).json({ success: false, message: checked.error });
    return;
  }

  const group = await UnitGroup.create({
    userId: req.userId,
    name: name.trim(),
    normalizedName: normalizeName(name),
    units: checked.units,
  });
  res.status(201).json({ success: true, group });
}

export async function updateUnitGroup(req: Request, res: Response): Promise<void> {
  const { name, units } = req.body as { name: string; units: UnitInput[] };

  const group = await UnitGroup.findOne({ _id: req.params.id, userId: req.userId });
  if (!group) {
    res.status(404).json({ success: false, message: "Unit group not found." });
    return;
  }
  const clash = await duplicateGroupName(req.userId!, name, group._id.toString());
  if (clash) {
    res.status(409).json({ success: false, message: `"${clash.name}" already exists.` });
    return;
  }
  const checked = validateUnits(units, group.units);
  if ("error" in checked) {
    res.status(400).json({ success: false, message: checked.error });
    return;
  }

  const keptIds = new Set(checked.units.filter((u) => u._id).map((u) => u._id!));
  const removedIds = group.units
    .map((u) => u._id)
    .filter((id) => !keptIds.has(id.toString()));

  group.name = name.trim();
  group.normalizedName = normalizeName(name);
  group.set("units", checked.units);
  await group.save();

  // Drop references to removed units from items. Past transactions keep the
  // unit name they recorded.
  if (removedIds.length > 0) {
    const filter = { userId: req.userId, unitGroupId: group._id };
    await CategoryItem.updateMany(filter, {
      $pull: { allowedUnitIds: { $in: removedIds }, presetOverrides: { unitId: { $in: removedIds } } },
    });
    await CategoryItem.updateMany(
      { ...filter, defaultUnitId: { $in: removedIds } },
      { $unset: { defaultUnitId: 1 } }
    );
  }

  res.status(200).json({ success: true, group });
}

export async function deleteUnitGroup(req: Request, res: Response): Promise<void> {
  const group = await UnitGroup.findOne({ _id: req.params.id, userId: req.userId });
  if (!group) {
    res.status(404).json({ success: false, message: "Unit group not found." });
    return;
  }

  const usage = await CategoryItem.countDocuments({ userId: req.userId, unitGroupId: group._id });
  if (usage > 0) {
    res.status(400).json({
      success: false,
      message: `Can't delete — ${usage} item${usage > 1 ? "s" : ""} use ${group.name}.`,
    });
    return;
  }

  await group.deleteOne();
  res.status(200).json({ success: true, message: "Unit group deleted." });
}
