import type { Request, Response } from "express";
import { Friend } from "../models/Friend.js";
import { SharedExpense } from "../models/SharedExpense.js";
import { netBalanceContribution } from "../utils/friendBalance.js";
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

// Frecency: each interaction adds 1 to a score that halves every 7 days.
const FRECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const FRECENCY_LAMBDA = Math.LN2 / FRECENCY_HALF_LIFE_MS;

/**
 * Record that the user interacted with a friend (opened their detail, split with
 * them). Decays the existing score to "now", then adds 1 — so recent, repeated
 * use ranks a friend higher and stale activity fades.
 */
export async function recordInteraction(
  req: Request,
  res: Response
): Promise<void> {
  const friend = await Friend.findOne({ _id: req.params.id, userId: req.userId });
  if (!friend) {
    res.status(404).json({ success: false, message: "Friend not found." });
    return;
  }

  const now = Date.now();
  const last = friend.lastInteractedAt ? friend.lastInteractedAt.getTime() : now;
  const decayed = (friend.frecencyScore || 0) * Math.exp(-FRECENCY_LAMBDA * Math.max(0, now - last));
  friend.frecencyScore = decayed + 1;
  friend.lastInteractedAt = new Date(now);
  await friend.save();

  res.status(200).json({ success: true, friend });
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
 * Per-expense math lives in utils/friendBalance.ts (shared with
 * splitController.getBalances) so the two never drift apart.
 */
async function calculateNetBalance(
  userId: string,
  friendId: mongoose.Types.ObjectId
): Promise<number> {
  // Also match expenses where this friend is the payer but not in splits
  // (e.g. friend paid for the user alone with no other participants).
  const expenses = await SharedExpense.find({
    userId,
    $or: [
      { "splits.friendId": friendId },
      { paidBy: friendId.toString() },
    ],
  });

  return expenses.reduce(
    (balance, expense) => balance + netBalanceContribution(expense, friendId.toString()),
    0
  );
}
