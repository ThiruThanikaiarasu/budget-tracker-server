import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Transaction } from "../models/Transaction.js";
import {
  getFinancialMonthRange,
  getCurrentFinancialMonth,
  getFinancialMonthForDate,
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
        isAdjustment: { $ne: true },
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
  const startDay = await getUserStartDay(req.userId!);

  // Build the trailing `months` financial-month labels (oldest first), walking
  // back from the user's current financial month — not calendar months, so
  // this lines up with every other budget/summary endpoint for users with a
  // custom financialMonthStartDay.
  const currentMonth = getCurrentFinancialMonth(startDay);
  const [curYear, curM] = currentMonth.split("-").map(Number);
  const monthLabels: string[] = [];
  let y = curYear;
  let m = curM;
  for (let i = 0; i < months; i++) {
    monthLabels.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }

  const earliestStart = getFinancialMonthRange(monthLabels[0], startDay).start;

  // Bucketing by financial month can't be expressed as a plain $year/$month
  // group (the day-shift/short-month clamping isn't a fixed calendar rule),
  // so pull the raw fields and bucket with the same helper every other
  // endpoint uses, keeping one source of truth for "which month is this in".
  const transactions = await Transaction.find({
    userId,
    type: { $in: ["income", "expense"] },
    isAdjustment: { $ne: true },
    date: { $gte: earliestStart },
  })
    .select("date type amount personalShare")
    .lean();

  const trendMap = new Map<string, { income: number; expense: number }>();
  for (const label of monthLabels) trendMap.set(label, { income: 0, expense: 0 });

  for (const tx of transactions) {
    const label = getFinancialMonthForDate(tx.date, startDay);
    const entry = trendMap.get(label);
    if (!entry) continue; // outside the requested window
    const amount = tx.personalShare ?? tx.amount;
    if (tx.type === "income") entry.income += amount;
    else if (tx.type === "expense") entry.expense += amount;
  }

  const trend = monthLabels.map((month) => ({
    month,
    income: trendMap.get(month)!.income,
    expense: trendMap.get(month)!.expense,
  }));

  res.status(200).json({ success: true, trend });
}
