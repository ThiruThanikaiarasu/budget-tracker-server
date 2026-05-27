import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Category } from "../models/Category.js";
import { User } from "../models/User.js";

export async function getCategories(
  req: Request,
  res: Response
): Promise<void> {
  const user = await User.findById(req.userId);
  const hiddenIds = (user?.hiddenCategoryIds ?? []).map((id) => id.toString());
  const categoryOrder = (user?.categoryOrder ?? []).map((id) => id.toString());

  const categories = await Category.find({
    $or: [{ userId: null }, { userId: req.userId }],
    _id: { $nin: hiddenIds },
  });

  const sorted = [...categories].sort((a, b) => {
    const ai = categoryOrder.indexOf(a._id.toString());
    const bi = categoryOrder.indexOf(b._id.toString());
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  res.status(200).json({ success: true, categories: sorted });
}

export async function createCategory(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, icon } = req.body;

  const category = await Category.create({ userId: req.userId, name, type, icon });

  await User.findByIdAndUpdate(req.userId, {
    $push: { categoryOrder: category._id },
  });

  res.status(201).json({ success: true, category });
}

export async function updateCategory(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, icon } = req.body;

  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404).json({ success: false, message: "Category not found." });
    return;
  }

  // Default category: clone as user's own and hide the original
  if (category.userId === null) {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const newCat = await Category.create({ userId: req.userId, name, type, icon });

    const originalId = category._id as mongoose.Types.ObjectId;

    if (!user.hiddenCategoryIds.some((id) => id.toString() === originalId.toString())) {
      user.hiddenCategoryIds.push(originalId);
    }

    // Replace original's position in order with the new category
    const orderIdx = user.categoryOrder.findIndex(
      (id) => id.toString() === originalId.toString()
    );
    if (orderIdx !== -1) {
      (user.categoryOrder as mongoose.Types.ObjectId[])[orderIdx] =
        newCat._id as mongoose.Types.ObjectId;
    } else {
      user.categoryOrder.push(newCat._id as mongoose.Types.ObjectId);
    }

    await user.save();
    res.status(200).json({ success: true, category: newCat });
    return;
  }

  if (category.userId.toString() !== req.userId) {
    res.status(404).json({ success: false, message: "Category not found." });
    return;
  }

  category.name = name;
  category.type = type;
  category.icon = icon;
  await category.save();

  res.status(200).json({ success: true, category });
}

export async function deleteCategory(
  req: Request,
  res: Response
): Promise<void> {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404).json({ success: false, message: "Category not found." });
    return;
  }

  // Default category: add to user's hidden list instead of deleting
  if (category.userId === null) {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    const catId = category._id as mongoose.Types.ObjectId;

    if (!user.hiddenCategoryIds.some((id) => id.toString() === catId.toString())) {
      user.hiddenCategoryIds.push(catId);
    }

    user.categoryOrder = user.categoryOrder.filter(
      (id) => id.toString() !== catId.toString()
    ) as mongoose.Types.ObjectId[];

    await user.save();
    res.status(200).json({ success: true, message: "Category removed." });
    return;
  }

  if (category.userId.toString() !== req.userId) {
    res.status(404).json({ success: false, message: "Category not found." });
    return;
  }

  await category.deleteOne();

  await User.findByIdAndUpdate(req.userId, {
    $pull: { categoryOrder: category._id },
  });

  res.status(200).json({ success: true, message: "Category deleted." });
}

export async function reorderCategories(
  req: Request,
  res: Response
): Promise<void> {
  const { orderedIds } = req.body;

  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found." });
    return;
  }

  user.categoryOrder = orderedIds.map(
    (id: string) => new mongoose.Types.ObjectId(id)
  );
  await user.save();

  res.status(200).json({ success: true });
}
