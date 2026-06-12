import type { Request, Response } from "express";
import mongoose from "mongoose";

function fmtRupee(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
import { Budget } from "../models/Budget.js";
import { Transaction } from "../models/Transaction.js";
import {
  getFinancialMonthRange,
  getCurrentFinancialMonth,
  getFinancialMonthForDate,
  getDaysLeftInPeriod,
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

/**
 * Computes the carry-forward pot for a category across all months up to currentMonth.
 * pot = Σ (limit(m) − spent(m)) for every budget month that includes this category.
 * Can be negative (overspend carries as debt into next month).
 */
async function computeCarryForwardPot(
  userId: string,
  categoryId: string,
  currentMonth: string,
  startDay: number
): Promise<number> {
  const budgets = await Budget.find({
    userId,
    "categoryBudgets.categoryId": new mongoose.Types.ObjectId(categoryId),
    month: { $lte: currentMonth },
  }).sort({ month: 1 });

  if (budgets.length === 0) return 0;

  let pot = 0;
  for (const budget of budgets) {
    const cb = budget.categoryBudgets.find(
      (c) => c.categoryId.toString() === categoryId
    );
    if (!cb) continue;

    const { start, end } = getFinancialMonthRange(budget.month, startDay);

    const result = await Transaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: "expense",
          categoryId: new mongoose.Types.ObjectId(categoryId),
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
        },
      },
    ]);

    const spent = result[0]?.total || 0;
    pot += cb.limit - spent;
  }

  return Math.round(pot * 100) / 100;
}

/** POST /budgets/precheck — server-side budget warning before saving a transaction. */
export async function precheck(
  req: Request,
  res: Response
): Promise<void> {
  const { categoryId, amount, date } = req.body;

  if (!amount || amount <= 0) {
    res.status(200).json({ success: true, warnings: [] });
    return;
  }

  const startDay = await getUserStartDay(req.userId!);
  const txDate = date ? new Date(date) : new Date();
  const month = getFinancialMonthForDate(txDate, startDay);
  const { start, end, daysInPeriod } = getFinancialMonthRange(month, startDay);

  const budget = await Budget.findOne({ userId: req.userId, month }).populate(
    "categoryBudgets.categoryId",
    "name icon"
  );

  if (!budget) {
    res.status(200).json({ success: true, warnings: [] });
    return;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  const warnings: string[] = [];

  // ── Overall daily adaptive limit ──────────────────────────────────
  if (budget.overallLimit) {
    const monthlyResult = await Transaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          type: "expense",
          date: { $gte: start, $lte: endOfToday },
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
    ]);
    const todayResult = await Transaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          type: "expense",
          date: { $gte: startOfToday, $lte: endOfToday },
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
    ]);

    const monthlySpent = monthlyResult[0]?.total || 0;
    const todaySpent = todayResult[0]?.total || 0;
    const remaining = budget.overallLimit - monthlySpent;
    const daysLeft = getDaysLeftInPeriod(today, end);
    const adaptiveDaily = Math.round((remaining / daysLeft) * 100) / 100;

    if (todaySpent + amount > adaptiveDaily) {
      warnings.push(
        `Today's total: ${fmtRupee(todaySpent + amount)} (today's limit: ${fmtRupee(adaptiveDaily)})`
      );
    }
  }

  // ── Category-specific check ───────────────────────────────────────
  if (categoryId) {
    const cb = budget.categoryBudgets.find(
      (c) => (c.categoryId as any)._id.toString() === categoryId
    );
    if (cb) {
      const catName = (cb.categoryId as any).name || "Category";
      const catIcon = (cb.categoryId as any).icon || "";

      if (cb.carryForward) {
        // Carry-forward: check against accumulated pot
        const pot = await computeCarryForwardPot(req.userId!, categoryId, month, startDay);
        if (pot - amount < 0) {
          const overshoot = Math.abs(pot - amount);
          warnings.push(
            `${catIcon} ${catName}: pot ${fmtRupee(pot)} — this exceeds by ${fmtRupee(overshoot)}`
          );
        }
      } else if (cb.frequency === "daily") {
        // Banked pot: fixed daily share + carryover from under/over-spending on prior days
        const priorDaysResult = await Transaction.aggregate([
          {
            $match: {
              userId: new mongoose.Types.ObjectId(req.userId),
              type: "expense",
              categoryId: new mongoose.Types.ObjectId(categoryId),
              date: { $gte: start, $lt: startOfToday },
            },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
        ]);
        const todayCatResult = await Transaction.aggregate([
          {
            $match: {
              userId: new mongoose.Types.ObjectId(req.userId),
              type: "expense",
              categoryId: new mongoose.Types.ObjectId(categoryId),
              date: { $gte: startOfToday, $lte: endOfToday },
            },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
        ]);

        const priorDaysSpent = priorDaysResult[0]?.total || 0;
        const todayCatSpent = todayCatResult[0]?.total || 0;
        const fixedDaily = cb.limit / daysInPeriod;
        const daysSoFar = Math.max(
          0,
          Math.min(
            daysInPeriod,
            Math.round((startOfToday.getTime() - start.getTime()) / 86400000)
          )
        );
        const pot = daysSoFar * fixedDaily - priorDaysSpent;
        const effectiveToday = Math.round((fixedDaily + pot) * 100) / 100;

        if (todayCatSpent + amount > effectiveToday) {
          warnings.push(
            `${catIcon} ${catName}: ${fmtRupee(todayCatSpent + amount)} today (today's limit incl. carryover: ${fmtRupee(effectiveToday)})`
          );
        }
      } else {
        // Standard monthly: compare month-to-date against limit
        const monthResult = await Transaction.aggregate([
          {
            $match: {
              userId: new mongoose.Types.ObjectId(req.userId),
              type: "expense",
              categoryId: new mongoose.Types.ObjectId(categoryId),
              date: { $gte: start, $lte: endOfToday },
            },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
        ]);
        const monthToDateSpent = monthResult[0]?.total || 0;

        if (monthToDateSpent + amount > cb.limit) {
          warnings.push(
            `${catIcon} ${catName}: ${fmtRupee(monthToDateSpent + amount)} this month (limit: ${fmtRupee(cb.limit)})`
          );
        }
      }
    }
  }

  res.status(200).json({ success: true, warnings });
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
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
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
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
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

  // For adaptive daily: compute today's remaining days in the period
  const today = new Date();
  const daysLeft = getDaysLeftInPeriod(today, end);

  const totalSpent = dailySpending.reduce(
    (sum: number, d: { total: number }) => sum + d.total,
    0
  );

  // Adaptive overall daily limit (as of today)
  const adaptiveOverallDaily = budget?.overallLimit
    ? Math.round(((budget.overallLimit - totalSpent) / daysLeft) * 100) / 100
    : null;

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

  const categorySummary = budget
    ? await Promise.all(
        budget.categoryBudgets.map(async (cb) => {
          const catId = String((cb.categoryId as any)._id ?? cb.categoryId);
          const catTotalSpent = categorySpendingMap[catId] || 0;
          const isDaily = cb.frequency === "daily";

          let pot: number | null = null;
          let adaptiveDaily: number | null = null;

          if (cb.carryForward) {
            pot = await computeCarryForwardPot(req.userId!, catId, month, startDay);
          } else if (isDaily) {
            const remaining = cb.limit - catTotalSpent;
            adaptiveDaily = Math.round((remaining / daysLeft) * 100) / 100;
          }

          return {
            categoryId: cb.categoryId,
            limit: cb.limit,
            frequency: cb.frequency,
            carryForward: cb.carryForward,
            dailyLimit: isDaily
              ? Math.round((cb.limit / daysInPeriod) * 100) / 100
              : null,
            adaptiveDaily,
            pot,
            totalSpent: catTotalSpent,
          };
        })
      )
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
      adaptiveOverallDaily,
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
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const endOfToday = new Date(
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
        date: { $gte: startOfToday, $lte: endOfToday },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
  ]);

  const todayCategoryExpenses = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: startOfToday, $lte: endOfToday },
        categoryId: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$categoryId",
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
  ]);

  const monthlyCategoryExpenses = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: start, $lte: endOfToday },
        categoryId: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$categoryId",
        total: { $sum: { $ifNull: ["$personalShare", "$amount"] } },
      },
    },
  ]);

  const todaySpent = todayExpenses[0]?.total || 0;
  const daysLeft = getDaysLeftInPeriod(today, end);

  // Adaptive overall daily limit
  const monthlyTotalResult = await Transaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(req.userId),
        type: "expense",
        date: { $gte: start, $lte: endOfToday },
      },
    },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$personalShare", "$amount"] } } } },
  ]);
  const monthlyTotalSpent = monthlyTotalResult[0]?.total || 0;

  const dailyLimit = budget.overallLimit
    ? Math.round(((budget.overallLimit - monthlyTotalSpent) / daysLeft) * 100) / 100
    : null;

  const categoryStatus = await Promise.all(
    budget.categoryBudgets.map(async (cb) => {
      const catId = String((cb.categoryId as any)._id ?? cb.categoryId);

      if (cb.carryForward) {
        // Carry-forward: pot is the effective limit
        const pot = await computeCarryForwardPot(req.userId!, catId, month, startDay);
        const catMonthlySpent =
          monthlyCategoryExpenses.find((e) => e._id.toString() === catId)?.total || 0;
        return {
          categoryId: cb.categoryId,
          frequency: cb.frequency,
          carryForward: true,
          limit: cb.limit,
          effectiveLimit: Math.max(0, pot),
          pot,
          spent: catMonthlySpent,
          isOver: pot < 0,
        };
      } else if (cb.frequency === "daily") {
        // Adaptive pacing: remaining ÷ days-left
        const catMonthlySpent =
          monthlyCategoryExpenses.find((e) => e._id.toString() === catId)?.total || 0;
        const remaining = cb.limit - catMonthlySpent;
        const adaptiveDaily = Math.round((remaining / daysLeft) * 100) / 100;

        const catTodaySpent =
          todayCategoryExpenses.find((e) => e._id.toString() === catId)?.total || 0;
        return {
          categoryId: cb.categoryId,
          frequency: cb.frequency,
          carryForward: false,
          limit: cb.limit,
          effectiveLimit: adaptiveDaily,
          pot: null,
          spent: catTodaySpent,
          isOver: catTodaySpent > adaptiveDaily,
        };
      } else {
        // Standard monthly
        const catMonthlySpent =
          monthlyCategoryExpenses.find((e) => e._id.toString() === catId)?.total || 0;
        return {
          categoryId: cb.categoryId,
          frequency: cb.frequency,
          carryForward: false,
          limit: cb.limit,
          effectiveLimit: cb.limit,
          pot: null,
          spent: catMonthlySpent,
          isOver: catMonthlySpent > cb.limit,
        };
      }
    })
  );

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
