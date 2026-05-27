import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Budget } from "../models/Budget.js";
import { Transaction } from "../models/Transaction.js";
import {
  getFinancialMonthRange,
  getCurrentFinancialMonth,
  getUserStartDay,
  buildPeriodDays,
} from "../utils/financialMonth.js";

export async function upsertBudget(
  req: Request,
  res: Response
): Promise<void> {
  const { month, overallLimit, categoryBudgets } = req.body;

  if (!overallLimit && (!categoryBudgets || categoryBudgets.length === 0)) {
    res.status(400).json({
      success: false,
      message: "Set an overall budget or at least one category budget.",
    });
    return;
  }

  const budget = await Budget.findOneAndUpdate(
    { userId: req.userId, month },
    {
      userId: req.userId,
      month,
      overallLimit: overallLimit || undefined,
      categoryBudgets: categoryBudgets || [],
    },
    { new: true, upsert: true, runValidators: true }
  );

  res.status(200).json({ success: true, budget });
}

export async function getBudget(
  req: Request,
  res: Response
): Promise<void> {
  const month = req.params.month as string;

  const budget = await Budget.findOne({ userId: req.userId, month }).populate(
    "categoryBudgets.categoryId",
    "name icon"
  );

  if (!budget) {
    res.status(404).json({ success: false, message: "No budget set for this month." });
    return;
  }

  res.status(200).json({ success: true, budget });
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getMonthlySummary(
  req: Request,
  res: Response
): Promise<void> {
  const month = req.params.month as string;
  const startDay = await getUserStartDay(req.userId!);
  const { start, end, daysInPeriod } = getFinancialMonthRange(month, startDay);

  const budget = await Budget.findOne({ userId: req.userId, month }).populate(
    "categoryBudgets.categoryId",
    "name icon"
  );

  const dailySpending = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const categorySpending = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: start, $lte: end },
        categoryId: { $exists: true },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          categoryId: "$categoryId",
        },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const categoryLimitSum = budget
    ? budget.categoryBudgets.reduce((sum, cb) => sum + cb.limit, 0)
    : 0;

  const totalBudget = budget?.overallLimit || categoryLimitSum || null;

  const dailyLimit = budget?.overallLimit
    ? Math.round((budget.overallLimit / daysInPeriod) * 100) / 100
    : null;

  const spendingMap: Record<string, number> = {};
  for (const entry of dailySpending) {
    spendingMap[entry._id] = entry.total;
  }

  const categorySpendingMap: Record<string, number> = {};
  for (const entry of categorySpending) {
    const catId = entry._id.categoryId.toString();
    categorySpendingMap[catId] =
      (categorySpendingMap[catId] || 0) + entry.total;
  }

  const periodDays = buildPeriodDays(start, daysInPeriod);

  const days = periodDays.map((pd, i) => {
    const spent = spendingMap[pd.date] || 0;
    return {
      day: i + 1,
      date: pd.date,
      spent,
      dailyLimit,
      isOver: dailyLimit !== null ? spent > dailyLimit : false,
    };
  });

  const totalSpent = dailySpending.reduce(
    (sum: number, d: { total: number }) => sum + d.total,
    0
  );

  const categorySummary = budget
    ? budget.categoryBudgets.map((cb) => {
        const catId = cb.categoryId.toString();
        const catTotalSpent = categorySpendingMap[catId] || 0;
        const isDaily = cb.frequency === "daily";
        return {
          categoryId: cb.categoryId,
          limit: cb.limit,
          frequency: cb.frequency,
          dailyLimit: isDaily
            ? Math.round((cb.limit / daysInPeriod) * 100) / 100
            : null,
          totalSpent: catTotalSpent,
        };
      })
    : [];

  res.status(200).json({
    success: true,
    summary: {
      month,
      daysInPeriod,
      periodStart: formatDateStr(start),
      overallLimit: budget?.overallLimit || null,
      totalBudget,
      dailyLimit,
      totalSpent,
      days,
      categorySummary,
    },
  });
}

export async function getTodaySummary(
  req: Request,
  res: Response
): Promise<void> {
  const startDay = await getUserStartDay(req.userId!);
  const month = getCurrentFinancialMonth(startDay);
  const { start, end, daysInPeriod } = getFinancialMonthRange(month, startDay);

  const today = new Date();
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const endOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    23,
    59,
    59,
    999
  );

  const budget = await Budget.findOne({ userId: req.userId, month }).populate(
    "categoryBudgets.categoryId",
    "name icon"
  );

  if (!budget) {
    res.status(200).json({ success: true, summary: null });
    return;
  }

  const todayExpenses = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amount" },
      },
    },
  ]);

  const todayCategoryExpenses = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: startOfDay, $lte: endOfDay },
        categoryId: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$categoryId",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const monthlyCategoryExpenses = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: start, $lte: endOfDay },
        categoryId: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$categoryId",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const todaySpent = todayExpenses[0]?.total || 0;
  const dailyLimit = budget.overallLimit
    ? Math.round((budget.overallLimit / daysInPeriod) * 100) / 100
    : null;

  const categoryStatus = budget.categoryBudgets.map((cb) => {
    const catId = cb.categoryId.toString();
    const isDaily = cb.frequency === "daily";

    if (isDaily) {
      const catDailyLimit =
        Math.round((cb.limit / daysInPeriod) * 100) / 100;
      const catSpent =
        todayCategoryExpenses.find((e) => e._id.toString() === catId)?.total ||
        0;
      return {
        categoryId: cb.categoryId,
        frequency: cb.frequency,
        limit: cb.limit,
        effectiveLimit: catDailyLimit,
        spent: catSpent,
        isOver: catSpent > catDailyLimit,
      };
    } else {
      const catMonthlySpent =
        monthlyCategoryExpenses.find((e) => e._id.toString() === catId)
          ?.total || 0;
      return {
        categoryId: cb.categoryId,
        frequency: cb.frequency,
        limit: cb.limit,
        effectiveLimit: cb.limit,
        spent: catMonthlySpent,
        isOver: catMonthlySpent > cb.limit,
      };
    }
  });

  res.status(200).json({
    success: true,
    summary: {
      dailyLimit,
      spent: todaySpent,
      isOver: dailyLimit !== null ? todaySpent > dailyLimit : false,
      categoryStatus,
    },
  });
}
