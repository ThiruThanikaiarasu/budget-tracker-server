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

    // When the expense is split, only the user's own share counts toward
    // their budget. splits hold the friends' amounts; the remainder is the
    // user's share of the full `amount`.
    let personalShare: number | undefined;
    if (splits && splits.length > 0) {
      const splitTotal = splits.reduce(
        (sum: number, s: { amount: number }) => sum + s.amount,
        0
      );
      personalShare = Math.round((amount - splitTotal) * 100) / 100;
    }

    await session.withTransaction(async () => {
      // Only update account balance if user paid (accountId present).
      // Use || undefined so an empty string from the client is treated as absent.
      const effectiveAccountId = paidByFriendId ? undefined : (accountId || undefined);
      await applyBalanceEffect(
        type,
        amount,
        effectiveAccountId,
        toAccountId || undefined,
        session
      );

      const docs = await Transaction.create(
        [
          {
            userId: req.userId,
            type,
            amount,
            personalShare,
            categoryId: categoryId || undefined,
            accountId: effectiveAccountId,
            toAccountId: toAccountId || undefined,
            paidByFriendId: paidByFriendId || undefined,
            note: note ?? undefined,
            date: new Date(date),
          },
        ],
        { session }
      );
      transaction = docs[0];

      // Auto-create SharedExpense when a friend paid OR when splits exist.
      // A friend paying with no other participants still creates a record so
      // the debt (user owes friend the full amount) is tracked in the balance.
      if (paidByFriendId || (splits && splits.length > 0)) {
        await SharedExpense.create(
          [
            {
              userId: req.userId,
              transactionId: transaction._id,
              description: note || "Shared expense",
              totalAmount: amount,
              paidBy: paidByFriendId || "user",
              date: new Date(date),
              splits: splits || [],
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
      .populate("toAccountId", "name")
      .populate("paidByFriendId", "name");

    console.log("[CREATE] saved paidByFriendId:", transaction!.paidByFriendId);
    console.log("[CREATE] populated paidByFriendId:", (populated as any)?.paidByFriendId);

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
      .populate("toAccountId", "name")
      .populate("paidByFriendId", "name"),
    Transaction.countDocuments(filter),
  ]);

  // Attach split details (friends + amounts) for any split transactions on
  // this page, so the edit form can be prefilled without a second round-trip.
  const splits = await SharedExpense.find({
    transactionId: { $in: transactions.map((t) => t._id) },
    isSettlement: false,
  })
    .select("transactionId paidBy splits")
    .populate("splits.friendId", "name");

  const splitByTxId = new Map(
    splits.map((s) => [s.transactionId!.toString(), s])
  );

  const transactionsWithSplit = transactions.map((t) => ({
    ...t.toObject(),
    split: splitByTxId.get(t._id!.toString()) ?? null,
  }));

  res.status(200).json({
    success: true,
    transactions: transactionsWithSplit,
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
    .populate("toAccountId", "name")
    .populate("paidByFriendId", "name");

  if (!transaction) {
    res
      .status(404)
      .json({ success: false, message: "Transaction not found." });
    return;
  }

  const split = await SharedExpense.findOne({
    transactionId: transaction._id,
    isSettlement: false,
  })
    .select("paidBy splits")
    .populate("splits.friendId", "name");

  res.status(200).json({
    success: true,
    transaction: { ...transaction.toObject(), split: split ?? null },
  });
}

export async function updateTransaction(
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

  // When split, only the user's own share counts toward the budget.
  let personalShare: number | undefined;
  if (splits && splits.length > 0) {
    const splitTotal = splits.reduce(
      (sum: number, s: { amount: number }) => sum + s.amount,
      0
    );
    if (splitTotal > amount) {
      res.status(400).json({
        success: false,
        message: "Split amounts exceed total amount.",
      });
      return;
    }
    personalShare = Math.round((amount - splitTotal) * 100) / 100;
  }

  // No account moves when a friend paid.
  // Use || undefined so an empty string from the client is treated as absent.
  const effectiveAccountId = paidByFriendId ? undefined : (accountId || undefined);

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
      await applyBalanceEffect(
        type,
        amount,
        effectiveAccountId,
        toAccountId || undefined,
        session
      );

      // Update the transaction document
      existing.type = type;
      existing.amount = amount;
      existing.personalShare = personalShare; // undefined clears it when not split
      existing.categoryId = categoryId || undefined;
      existing.accountId = effectiveAccountId;
      existing.toAccountId = toAccountId || undefined;
      existing.paidByFriendId = paidByFriendId || undefined;
      existing.note = note ?? undefined;
      existing.date = new Date(date);
      await existing.save({ session });

      // Keep the linked SharedExpense in sync with the edited split
      const existingSplit = await SharedExpense.findOne({
        transactionId: existing._id,
        isSettlement: false,
      }).session(session);

      if (paidByFriendId || (splits && splits.length > 0)) {
        if (existingSplit) {
          existingSplit.description = note || "Shared expense";
          existingSplit.totalAmount = amount;
          existingSplit.paidBy = paidByFriendId || "user";
          existingSplit.date = new Date(date);
          existingSplit.splits = splits || [];
          await existingSplit.save({ session });
        } else {
          await SharedExpense.create(
            [
              {
                userId: req.userId,
                transactionId: existing._id,
                description: note || "Shared expense",
                totalAmount: amount,
                paidBy: paidByFriendId || "user",
                date: new Date(date),
                splits: splits || [],
                isSettlement: false,
              },
            ],
            { session }
          );
        }
      } else if (existingSplit) {
        // Split was removed on edit — drop the now-orphaned record
        await SharedExpense.deleteOne(
          { _id: existingSplit._id },
          { session }
        );
      }
    });

    const populated = await Transaction.findById(existing._id)
      .populate("categoryId", "name icon")
      .populate("accountId", "name")
      .populate("toAccountId", "name")
      .populate("paidByFriendId", "name");

    const split = await SharedExpense.findOne({
      transactionId: existing._id,
      isSettlement: false,
    })
      .select("paidBy splits")
      .populate("splits.friendId", "name");

    res.status(200).json({
      success: true,
      transaction: { ...populated!.toObject(), split: split ?? null },
    });
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

      // Remove the linked split, if any, so it doesn't orphan
      await SharedExpense.deleteOne(
        { transactionId: existing._id, isSettlement: false },
        { session }
      );
    });

    res
      .status(200)
      .json({ success: true, message: "Transaction deleted successfully." });
  } finally {
    await session.endSession();
  }
}
