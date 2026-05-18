import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Transaction } from "../models/Transaction.js";
import { Account } from "../models/Account.js";
import { SharedExpense } from "../models/SharedExpense.js";
import { Friend } from "../models/Friend.js";

async function applyBalanceEffect(
  type: string,
  amount: number,
  accountId: string | undefined,
  toAccountId: string | undefined,
  session: mongoose.ClientSession,
  reverse = false
): Promise<void> {
  // Skip balance update when no account (friend-paid debt transactions)
  if (!accountId) return;

  const sign = reverse ? -1 : 1;

  if (type === "income") {
    await Account.updateOne(
      { _id: accountId },
      { $inc: { balance: sign * amount } },
      { session }
    );
  } else if (type === "expense") {
    await Account.updateOne(
      { _id: accountId },
      { $inc: { balance: sign * -amount } },
      { session }
    );
  } else if (type === "transfer") {
    await Account.updateOne(
      { _id: accountId },
      { $inc: { balance: sign * -amount } },
      { session }
    );
    await Account.updateOne(
      { _id: toAccountId },
      { $inc: { balance: sign * amount } },
      { session }
    );
  }
}

export async function createTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const {
    type,
    amount,
    categoryId,
    accountId,
    toAccountId,
    note,
    date,
    paidByFriendId,
    splits,
  } = req.body;

  // If friend paid, validate the friend exists
  if (paidByFriendId) {
    const friend = await Friend.findOne({
      _id: paidByFriendId,
      userId: req.userId,
    });
    if (!friend) {
      res.status(400).json({ success: false, message: "Friend not found." });
      return;
    }
  }

  const session = await mongoose.startSession();
  try {
    let transaction: InstanceType<typeof Transaction> | null = null;

    await session.withTransaction(async () => {
      // Only update account balance if user paid (accountId present)
      const effectiveAccountId = paidByFriendId ? undefined : accountId;
      await applyBalanceEffect(
        type,
        amount,
        effectiveAccountId,
        toAccountId,
        session
      );

      const docs = await Transaction.create(
        [
          {
            userId: req.userId,
            type,
            amount,
            categoryId: categoryId ?? undefined,
            accountId: effectiveAccountId ?? undefined,
            toAccountId: toAccountId ?? undefined,
            note: note ?? undefined,
            date: new Date(date),
          },
        ],
        { session }
      );
      transaction = docs[0];

      // Auto-create SharedExpense if splits are provided
      if (splits && splits.length > 0) {
        await SharedExpense.create(
          [
            {
              userId: req.userId,
              description: note || "Shared expense",
              totalAmount: amount,
              paidBy: paidByFriendId || "user",
              date: new Date(date),
              splits,
              isSettlement: false,
            },
          ],
          { session }
        );
      }
    });

    const populated = await Transaction.findById(transaction!._id)
      .populate("categoryId", "name icon")
      .populate("accountId", "name")
      .populate("toAccountId", "name");

    res.status(201).json({ success: true, transaction: populated });
  } finally {
    await session.endSession();
  }
}

export async function getTransactions(
  req: Request,
  res: Response
): Promise<void> {
  const {
    dateFrom,
    dateTo,
    type,
    categoryId,
    accountId,
    page: pageStr,
    limit: limitStr,
  } = req.query;

  const page = Math.max(1, parseInt(pageStr as string, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(limitStr as string, 10) || 20));

  const filter: Record<string, unknown> = { userId: req.userId };

  if (type) filter.type = type;
  if (categoryId) filter.categoryId = categoryId;
  if (accountId) filter.accountId = accountId;

  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.$gte = new Date(dateFrom as string);
    if (dateTo) dateFilter.$lte = new Date(dateTo as string);
    filter.date = dateFilter;
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("categoryId", "name icon")
      .populate("accountId", "name")
      .populate("toAccountId", "name"),
    Transaction.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}

export async function getTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const transaction = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
  })
    .populate("categoryId", "name icon")
    .populate("accountId", "name")
    .populate("toAccountId", "name");

  if (!transaction) {
    res
      .status(404)
      .json({ success: false, message: "Transaction not found." });
    return;
  }

  res.status(200).json({ success: true, transaction });
}

export async function updateTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const { type, amount, categoryId, accountId, toAccountId, note, date } =
    req.body;

  const existing = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!existing) {
    res
      .status(404)
      .json({ success: false, message: "Transaction not found." });
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Reverse old balance effect
      await applyBalanceEffect(
        existing.type,
        existing.amount,
        existing.accountId?.toString(),
        existing.toAccountId?.toString(),
        session,
        true
      );

      // Apply new balance effect
      await applyBalanceEffect(type, amount, accountId, toAccountId, session);

      // Update the transaction document
      existing.type = type;
      existing.amount = amount;
      existing.categoryId = categoryId ?? undefined;
      existing.accountId = accountId ?? undefined;
      existing.toAccountId = toAccountId ?? undefined;
      existing.note = note ?? undefined;
      existing.date = new Date(date);
      await existing.save({ session });
    });

    const populated = await Transaction.findById(existing._id)
      .populate("categoryId", "name icon")
      .populate("accountId", "name")
      .populate("toAccountId", "name");

    res.status(200).json({ success: true, transaction: populated });
  } finally {
    await session.endSession();
  }
}

export async function deleteTransaction(
  req: Request,
  res: Response
): Promise<void> {
  const existing = await Transaction.findOne({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!existing) {
    res
      .status(404)
      .json({ success: false, message: "Transaction not found." });
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Reverse the balance effect
      await applyBalanceEffect(
        existing.type,
        existing.amount,
        existing.accountId?.toString(),
        existing.toAccountId?.toString(),
        session,
        true
      );

      await Transaction.deleteOne({ _id: existing._id }, { session });
    });

    res
      .status(200)
      .json({ success: true, message: "Transaction deleted successfully." });
  } finally {
    await session.endSession();
  }
}
