import type { Request, Response } from "express";
import mongoose from "mongoose";
import { SharedExpense } from "../models/SharedExpense.js";
import { Friend } from "../models/Friend.js";

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
  const { friendId, amount } = req.body;

  const friend = await Friend.findOne({
    _id: friendId,
    userId: req.userId,
  });

  if (!friend) {
    res.status(404).json({ success: false, message: "Friend not found." });
    return;
  }

  const settlement = await SharedExpense.create({
    userId: req.userId,
    description: `Settlement with ${friend.name}`,
    totalAmount: amount,
    paidBy: "user",
    date: new Date(),
    splits: [{ friendId, amount }],
    isSettlement: true,
  });

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
