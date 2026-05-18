import type { Request, Response } from "express";
import { Category } from "../models/Category.js";

export async function getCategories(
  req: Request,
  res: Response
): Promise<void> {
  const categories = await Category.find({
    $or: [{ userId: null }, { userId: req.userId }],
  }).sort({ name: 1 });

  res.status(200).json({ success: true, categories });
}

export async function createCategory(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, icon } = req.body;

  const category = await Category.create({
    userId: req.userId,
    name,
    type,
    icon,
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

  if (category.userId === null) {
    res.status(403).json({
      success: false,
      message: "Cannot edit a default category.",
    });
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
