import type { Request, Response } from "express";
import mongoose from "mongoose";
import { SharedExpense } from "../models/SharedExpense.js";
import { Friend } from "../models/Friend.js";
import { Account } from "../models/Account.js";
import { Category } from "../models/Category.js";
import { Transaction } from "../models/Transaction.js";

// Get an existing category by name+type for this user, or create it.
async function getOrCreateCategory(
  userId: string,
  name: string,
  type: "income" | "expense"
): Promise<mongoose.Types.ObjectId> {
  let category = await Category.findOne({ userId, name, type });
  if (!category) {
    category = await Category.create({ userId, name, type });
  }
  return category._id as mongoose.Types.ObjectId;
}

export async function createSharedExpense(
  req: Request,
  res: Response
): Promise<void> {
  const { description, totalAmount, paidBy, date, splits } = req.body;

  // Validate that all friend IDs belong to this user
  const friendIds = splits.map(
    (s: { friendId: string }) => new mongoose.Types.ObjectId(s.friendId)
  );
  const friendCount = await Friend.countDocuments({
    _id: { $in: friendIds },
    userId: req.userId,
  });

  if (friendCount !== friendIds.length) {
    res.status(400).json({
      success: false,
      message: "One or more friends not found.",
    });
    return;
  }

  // If paidBy is a friendId, validate it belongs to user
  if (paidBy !== "user") {
    const payerFriend = await Friend.findOne({
      _id: paidBy,
      userId: req.userId,
    });
    if (!payerFriend) {
      res.status(400).json({
        success: false,
        message: "Payer friend not found.",
      });
      return;
    }
  }

  // Validate split amounts sum + user's share = totalAmount
  const splitTotal = splits.reduce(
    (sum: number, s: { amount: number }) => sum + s.amount,
    0
  );
  if (splitTotal > totalAmount) {
    res.status(400).json({
      success: false,
      message: "Split amounts exceed total amount.",
    });
    return;
  }

  const expense = await SharedExpense.create({
    userId: req.userId,
    description,
    totalAmount,
    paidBy,
    date: date ?? new Date(),
    splits,
    isSettlement: false,
  });

  res.status(201).json({ success: true, expense });
}

export async function getSharedExpenses(
  req: Request,
  res: Response
): Promise<void> {
  const filter: Record<string, unknown> = { userId: req.userId };

  if (req.query.friendId) {
    filter.$or = [
      { "splits.friendId": req.query.friendId },
      { paidBy: req.query.friendId },
    ];
  }

  const expenses = await SharedExpense.find(filter)
    .populate("splits.friendId", "name")
    .sort({ date: -1 });

  res.status(200).json({ success: true, expenses });
}

export async function getBalances(
  req: Request,
  res: Response
): Promise<void> {
  const friends = await Friend.find({ userId: req.userId });
  const expenses = await SharedExpense.find({ userId: req.userId });

  const balances = friends.map((friend) => {
    let balance = 0;

    for (const expense of expenses) {
      const friendSplit = expense.splits.find(
        (s) => s.friendId.toString() === friend._id!.toString()
      );

      if (expense.isSettlement) {
        if (!friendSplit) continue;
        if (expense.paidBy === "user") {
          balance -= friendSplit.amount;
        } else if (expense.paidBy.toString() === friend._id!.toString()) {
          balance += friendSplit.amount;
        }
      } else {
        if (expense.paidBy === "user") {
          if (!friendSplit) continue;
          balance += friendSplit.amount;
        } else if (expense.paidBy.toString() === friend._id!.toString()) {
          const totalFriendSplits = expense.splits.reduce(
            (sum, s) => sum + s.amount,
            0
          );
          const userShare = expense.totalAmount - totalFriendSplits;
          balance -= userShare;
        }
      }
    }

    return {
      friendId: friend._id,
      name: friend.name,
      netBalance: balance,
    };
  });

  res.status(200).json({ success: true, balances });
}

export async function settleUp(
  req: Request,
  res: Response
): Promise<void> {
  const {
    friendId,
    amount,
    method,
    friendOwes,
    accountId,
    coveredExpenseIds,
  }: {
    friendId: string;
    amount: number;
    method: "received" | "paid" | "waived";
    friendOwes: boolean;
    accountId?: string;
    coveredExpenseIds?: string[];
  } = req.body;

  const friend = await Friend.findOne({
    _id: friendId,
    userId: req.userId,
  });

  if (!friend) {
    res.status(404).json({ success: false, message: "Friend not found." });
    return;
  }

  // received (friend paid you) / paid (you paid friend) move real money, so an
  // account is required and gets validated.
  if (method === "received" || method === "paid") {
    if (!accountId) {
      res.status(400).json({
        success: false,
        message: "An account is required for this settlement.",
      });
      return;
    }
    const account = await Account.findOne({ _id: accountId, userId: req.userId });
    if (!account) {
      res.status(404).json({ success: false, message: "Account not found." });
      return;
    }
  }

  // Validate that any covered expenses belong to this user and this friend.
  let coveredIds: mongoose.Types.ObjectId[] = [];
  if (coveredExpenseIds && coveredExpenseIds.length > 0) {
    const covered = await SharedExpense.find({
      _id: { $in: coveredExpenseIds },
      userId: req.userId,
      isSettlement: false,
      $or: [{ "splits.friendId": friendId }, { paidBy: friendId }],
    }).select("_id");
    if (covered.length !== coveredExpenseIds.length) {
      res.status(400).json({
        success: false,
        message: "One or more expenses to settle were not found.",
      });
      return;
    }
    coveredIds = covered.map((c) => c._id as mongoose.Types.ObjectId);
  }

  const now = new Date();

  // The settlement SharedExpense cancels the debt in the balance math. Its
  // direction is set by paidBy: "user" reduces what the friend owes you,
  // the friendId reduces what you owe the friend.
  const settlement = await SharedExpense.create({
    userId: req.userId,
    description: `Settlement with ${friend.name}`,
    totalAmount: amount,
    paidBy: friendOwes ? "user" : friendId,
    date: now,
    splits: [{ friendId, amount }],
    isSettlement: true,
    settlementMethod: method,
    coveredExpenseIds: coveredIds,
  });

  // Reflect the real-world money movement as a Transaction (and account balance).
  if (method === "received") {
    // Friend paid you back — money lands in the chosen account.
    const categoryId = await getOrCreateCategory(
      req.userId!,
      "Settlement",
      "income"
    );
    await Transaction.create({
      userId: req.userId,
      type: "income",
      amount,
      categoryId,
      accountId,
      note: `Settlement from ${friend.name}`,
      date: now,
    });
    await Account.updateOne(
      { _id: accountId, userId: req.userId },
      { $inc: { balance: amount } }
    );
  } else if (method === "paid") {
    // You paid the friend back — money leaves the chosen account.
    const categoryId = await getOrCreateCategory(
      req.userId!,
      "Settlement",
      "expense"
    );
    await Transaction.create({
      userId: req.userId,
      type: "expense",
      amount,
      categoryId,
      accountId,
      note: `Settlement to ${friend.name}`,
      date: now,
    });
    await Account.updateOne(
      { _id: accountId, userId: req.userId },
      { $inc: { balance: -amount } }
    );
  } else if (method === "waived" && friendOwes) {
    // You forgave what the friend owed — you absorb it as your own spend.
    // No account moves (the original bill already left your account); this is
    // purely a budget/expense record.
    const categoryId = await getOrCreateCategory(
      req.userId!,
      "Waived",
      "expense"
    );
    await Transaction.create({
      userId: req.userId,
      type: "expense",
      amount,
      categoryId,
      personalShare: amount,
      note: `Waived debt for ${friend.name}`,
      date: now,
    });
  }
  // method === "waived" && !friendOwes: the friend forgave your debt. Nothing
  // moves and it isn't your income; the settlement record alone clears it.

  res.status(201).json({ success: true, settlement });
}

export async function deleteSharedExpense(
  req: Request,
  res: Response
): Promise<void> {
  const expense = await SharedExpense.findOneAndDelete({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!expense) {
    res.status(404).json({
      success: false,
      message: "Shared expense not found.",
    });
    return;
  }

  res.status(200).json({ success: true, message: "Shared expense deleted." });
}
