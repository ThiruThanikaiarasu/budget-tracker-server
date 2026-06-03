import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Account } from "../models/Account.js";
import { Transaction } from "../models/Transaction.js";

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

  const txDate = date ? new Date(date) : new Date();

  const session = await mongoose.startSession();
  let transaction: InstanceType<typeof Transaction> | null = null;
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

      // Record the transfer so it appears in transaction history. Balances are
      // already adjusted above, so we do NOT re-apply any balance effect here.
      const docs = await Transaction.create(
        [
          {
            userId: req.userId,
            type: "transfer",
            amount,
            accountId: fromAccountId,
            toAccountId,
            note: note ?? undefined,
            date: txDate,
          },
        ],
        { session }
      );
      transaction = docs[0];
    });
  } finally {
    await session.endSession();
  }

  const populated = await Transaction.findById(transaction!._id)
    .populate("accountId", "name")
    .populate("toAccountId", "name");

  res.status(200).json({
    success: true,
    transfer: {
      fromAccount: fromAccountId,
      toAccount: toAccountId,
      amount,
      note: note ?? null,
      date: txDate.toISOString(),
    },
    transaction: populated,
  });
}
