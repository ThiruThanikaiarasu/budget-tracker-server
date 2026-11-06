import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Transaction } from "../models/Transaction.js";
import { Account } from "../models/Account.js";
import {
  getFinancialMonthRange,
  getCurrentFinancialMonth,
  getFinancialMonthForDate,
  getUserStartDay,
} from "../utils/financialMonth.js";
import { categoryAllocationStages } from "../utils/categoryAllocation.js";
import { Category } from "../models/Category.js";
import { SharedExpense } from "../models/SharedExpense.js";
import { analyseMonth, attachPrevious, buildInsights, type AnalysisTx, type Basis, type CatInfo } from "../utils/monthAnalysis.js";

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

  // Money in hand right now. UPI means the bank accounts (what UPI draws on);
  // cash is the cash accounts. Wallets, cards and investments aren't in hand.
  const liquid = await Account.find({
    userId,
    isActive: true,
    type: { $in: ["bank_account", "cash"] },
  })
    .select("name type balance")
    .sort({ name: 1 })
    .lean();
  const part = (type: string) => liquid.filter((a) => a.type === type).map((a) => ({ name: a.name, balance: a.balance }));
  const total = (list: { balance: number }[]) => Math.round(list.reduce((sum, a) => sum + a.balance, 0) * 100) / 100;
  const upi = part("bank_account");
  const cash = part("cash");

  res.status(200).json({
    success: true,
    summary: {
      totalIncome,
      totalExpense,
      net: totalIncome - totalExpense,
      inHand: { upi: total(upi), cash: total(cash), accounts: { upi, cash } },
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
    ...categoryAllocationStages,
    {
      $group: {
        _id: "$alloc.categoryId",
        total: { $sum: "$alloc.amount" },
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


/** The month shown as one story: what was bought, from where, what extras came on top. */
export async function getMonthAnalysis(req: Request, res: Response): Promise<void> {
  const userId = new mongoose.Types.ObjectId(req.userId);
  const startDay = await getUserStartDay(req.userId!);
  const asked = typeof req.query.month === "string" ? req.query.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : getCurrentFinancialMonth(startDay);
  const basis: Basis = req.query.basis === "bill" ? "bill" : "mine";

  // This month and the five before it, for the trend and the "last month" comparisons.
  const shift = (m: string, by: number) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const months = [-5, -4, -3, -2, -1, 0].map((n) => shift(month, n));
  const prevMonth = months[months.length - 2];
  const range = getFinancialMonthRange(month, startDay);
  const from = getFinancialMonthRange(months[0], startDay).start;

  const [txs, categories] = await Promise.all([
    Transaction.find({ userId, type: "expense", isAdjustment: { $ne: true }, date: { $gte: from, $lte: range.end } })
      .select("amount personalShare categoryId merchant date items charges")
      .lean(),
    Category.find({ $or: [{ userId }, { userId: null }] }).select("name icon").lean(),
  ]);
  const cats = new Map<string, CatInfo>(categories.map((c) => [String(c._id), { name: c.name, icon: c.icon ?? "" }]));

  // Who each split bill was shared between, so every item can be divided the way it was ticked.
  const splitIds = (txs as unknown as { _id: mongoose.Types.ObjectId; personalShare?: number }[]).filter((t) => t.personalShare != null).map((t) => t._id);
  const shared = splitIds.length
    ? await SharedExpense.find({ userId, transactionId: { $in: splitIds } }).select("transactionId splits").lean()
    : [];
  const people = new Map<string, string[]>(shared.map((e) => [String(e.transactionId), ["user", ...e.splits.map((s) => String(s.friendId))]]));
  for (const t of txs as unknown as (AnalysisTx & { _id: mongoose.Types.ObjectId })[]) t.participants = people.get(String(t._id)) ?? null;

  const buckets = new Map<string, AnalysisTx[]>();
  for (const t of txs as unknown as AnalysisTx[]) {
    const m = getFinancialMonthForDate(t.date, startDay);
    if (!buckets.has(m)) buckets.set(m, []);
    buckets.get(m)!.push(t);
  }
  const cur = analyseMonth(buckets.get(month) ?? [], basis, cats);
  const prev = (buckets.get(prevMonth)?.length ?? 0) > 0 ? analyseMonth(buckets.get(prevMonth)!, basis, cats) : null;
  attachPrevious(cur, prev);

  const trend = months.map((m) => {
    const t = analyseMonth(buckets.get(m) ?? [], basis, cats).totals;
    return { month: m, spent: t.spent, items: t.items, fees: t.fees, discounts: t.discounts, bills: t.bills };
  });

  res.json({
    month, prevMonth, basis,
    start: range.start, end: range.end,
    ...cur,
    prevTotals: prev?.totals ?? null,
    trend,
    insights: buildInsights(cur, prev),
  });
}
