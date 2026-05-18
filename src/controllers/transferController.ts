import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Account } from "../models/Account.js";

export async function createTransfer(
  req: Request,
  res: Response
): Promise<void> {
  const { fromAccountId, toAccountId, amount, note, date } = req.body;

  if (fromAccountId === toAccountId) {
    res.status(400).json({
      success: false,
      message: "Source and destination accounts must be different.",
    });
    return;
  }

  const [fromAccount, toAccount] = await Promise.all([
    Account.findOne({ _id: fromAccountId, userId: req.userId }),
    Account.findOne({ _id: toAccountId, userId: req.userId }),
  ]);

  if (!fromAccount || !toAccount) {
    res.status(404).json({
      success: false,
      message: "One or both accounts not found.",
    });
    return;
  }

  if (!fromAccount.isActive || !toAccount.isActive) {
    res.status(400).json({
      success: false,
      message: "Both accounts must be active.",
    });
    return;
  }

  if (fromAccount.balance < amount) {
    res.status(400).json({
      success: false,
      message: "Insufficient balance in source account.",
    });
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Account.updateOne(
        { _id: fromAccountId },
        { $inc: { balance: -amount } },
        { session }
      );
      await Account.updateOne(
        { _id: toAccountId },
        { $inc: { balance: amount } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  res.status(200).json({
    success: true,
    transfer: {
      fromAccount: fromAccountId,
      toAccount: toAccountId,
      amount,
      note: note ?? null,
      date: date ?? new Date().toISOString(),
    },
  });
}
