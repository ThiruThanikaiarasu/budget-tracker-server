import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Transaction } from "../models/Transaction.js";
import {
  getFinancialMonthRange,
  getCurrentFinancialMonth,
  getUserStartDay,
} from "../utils/financialMonth.js";

export async function getSummary(
  req: Request,
  res: Response
): Promise<void> {
  const userId = new mongoose.Types.ObjectId(req.userId);
  const startDay = await getUserStartDay(req.userId!);
  const currentMonth = getCurrentFinancialMonth(startDay);
  const { start, end } = getFinancialMonthRange(currentMonth, startDay);

  const result = await Transaction.aggregate([
    {
      $match: {
        userId,
        type: { $in: ["income", "expense"] },
        date: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: "$type",
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
  ]);

  let totalIncome = 0;
  let totalExpense = 0;

  for (const item of result) {
    if (item._id === "income") totalIncome = item.total;
    if (item._id === "expense") totalExpense = item.total;
  }

  res.status(200).json({
    success: true,
    summary: {
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
    },
  });
}

export async function getCategoryBreakdown(
  req: Request,
  res: Response
): Promise<void> {
  const userId = new mongoose.Types.ObjectId(req.userId);
  const startDay = await getUserStartDay(req.userId!);
  const monthParam = req.query.month as string | undefined;

  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : getCurrentFinancialMonth(startDay);

  const { start, end } = getFinancialMonthRange(month, startDay);

  const result = await Transaction.aggregate([
    {
      $match: {
        userId,
        type: "expense",
        date: { $gte: start, $lte: end },
        categoryId: { $ne: null },
      },
    },
    {
      $group: {
        _id: "$categoryId",
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: "$category" },
    {
      $project: {
        _id: 0,
        categoryId: "$_id",
        categoryName: "$category.name",
        categoryIcon: "$category.icon",
        total: 1,
      },
    },
    { $sort: { total: -1 } },
  ]);

  res.status(200).json({ success: true, breakdown: result });
}

export async function getMonthlyTrend(
  req: Request,
  res: Response
): Promise<void> {
  const userId = new mongoose.Types.ObjectId(req.userId);
  const months = Math.max(1, Math.min(24, parseInt(req.query.months as string, 10) || 6));

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const result = await Transaction.aggregate([
    {
      $match: {
        userId,
        type: { $in: ["income", "expense"] },
        date: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$date" },
          month: { $month: "$date" },
          type: "$type",
        },
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
  ]);

  const trendMap = new Map<string, { income: number; expense: number }>();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    trendMap.set(key, { income: 0, expense: 0 });
  }

  for (const item of result) {
    const key = `${item._id.year}-${String(item._id.month).padStart(2, "0")}`;
    const entry = trendMap.get(key);
    if (entry) {
      if (item._id.type === "income") entry.income = item.total;
      if (item._id.type === "expense") entry.expense = item.total;
    }
  }

  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      income: data.income,
      expense: data.expense,
    }));

  res.status(200).json({ success: true, trend });
}
