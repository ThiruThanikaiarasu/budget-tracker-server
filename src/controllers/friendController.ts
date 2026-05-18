import type { Request, Response } from "express";
import { Friend } from "../models/Friend.js";
import { SharedExpense } from "../models/SharedExpense.js";
import mongoose from "mongoose";

export async function createFriend(
  req: Request,
  res: Response
): Promise<void> {
  const { name, phone, email } = req.body;

  const friend = await Friend.create({
    userId: req.userId,
    name,
    phone,
    email,
  });

  res.status(201).json({ success: true, friend });
}

export async function getFriends(
  req: Request,
  res: Response
): Promise<void> {
  const friends = await Friend.find({ userId: req.userId }).sort({
    createdAt: -1,
  });

  // Calculate net balance for each friend
  const friendsWithBalance = await Promise.all(
    friends.map(async (friend) => {
      const balance = await calculateNetBalance(
        req.userId!,
        friend._id as mongoose.Types.ObjectId
      );
      return {
        ...friend.toObject(),
        netBalance: balance,
      };
    })
  );

  res.status(200).json({ success: true, friends: friendsWithBalance });
}

export async function updateFriend(
  req: Request,
  res: Response
): Promise<void> {
  const { name, phone, email } = req.body;

  const friend = await Friend.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { name, phone, email },
    { new: true, runValidators: true }
  );

  if (!friend) {
    res.status(404).json({ success: false, message: "Friend not found." });
    return;
  }

  res.status(200).json({ success: true, friend });
}

/**
 * Calculate net balance with a friend.
 * Positive = friend owes user, Negative = user owes friend.
 *
 * Logic:
 * - If user paid: each friend's split amount is what they owe the user (+)
 * - If friend paid: the user's implied share is what the user owes that friend (-)
 *   The user's share = totalAmount - sum(all friend splits)
 *   But we only care about this specific friend, so:
 *   - If this friend paid: user owes their own share to this friend (-)
 *   - For splits where another friend paid: no effect on this friend's balance
 */
async function calculateNetBalance(
  userId: string,
  friendId: mongoose.Types.ObjectId
): Promise<number> {
  const expenses = await SharedExpense.find({
    userId,
    "splits.friendId": friendId,
  });

  let balance = 0;

  for (const expense of expenses) {
    const friendSplit = expense.splits.find(
      (s) => s.friendId.toString() === friendId.toString()
    );
    if (!friendSplit) continue;

    if (expense.isSettlement) {
      // Settlement: paidBy = "user" means user paid friend (balance decreases)
      // paidBy = friendId means friend paid user (balance increases)
      if (expense.paidBy === "user") {
        balance -= friendSplit.amount;
      } else if (expense.paidBy.toString() === friendId.toString()) {
        balance += friendSplit.amount;
      }
    } else {
      if (expense.paidBy === "user") {
        // User paid, friend owes their split
        balance += friendSplit.amount;
      } else if (expense.paidBy.toString() === friendId.toString()) {
        // Friend paid, user owes their share
        // User's share = totalAmount - sum of all friend splits
        const totalFriendSplits = expense.splits.reduce(
          (sum, s) => sum + s.amount,
          0
        );
        const userShare = expense.totalAmount - totalFriendSplits;
        balance -= userShare;
      }
    }
  }

  return balance;
}
