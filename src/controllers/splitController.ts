import type { Request, Response } from "express";
import mongoose from "mongoose";
import { SharedExpense } from "../models/SharedExpense.js";
import { Friend } from "../models/Friend.js";
import { Account } from "../models/Account.js";
import { Category } from "../models/Category.js";
import { Transaction } from "../models/Transaction.js";
import { netBalanceContribution } from "../utils/friendBalance.js";

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
    .populate({
      path: "transactionId",
      select: "categoryId items charges",
      populate: { path: "categoryId", select: "name icon" },
    })
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
    const friendId = friend._id!.toString();
    const balance = expenses.reduce(
      (sum, expense) => sum + netBalanceContribution(expense, friendId),
      0
    );

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
    waivedAmount,
  }: {
    friendId: string;
    amount: number;
    method: "received" | "paid" | "waived";
    friendOwes: boolean;
    accountId?: string;
    coveredExpenseIds?: string[];
    waivedAmount?: number;
  } = req.body;

  // A partial payment can forgive the rest in the same step. That only makes
  // sense next to a payment — a plain waive already forgives the whole amount.
  if (waivedAmount && method === "waived") {
    res.status(400).json({
      success: false,
      message: "waivedAmount only goes with a received or paid settlement.",
    });
    return;
  }
  const forgiven = waivedAmount ?? 0;

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

  // Validate that any covered expenses belong to this user and this friend,
  // and that the submitted amount actually matches what's outstanding on
  // them — the client computes `amount`/`friendOwes` independently, and
  // without this check a client bug could silently move the wrong amount.
  let coveredIds: mongoose.Types.ObjectId[] = [];
  if (coveredExpenseIds && coveredExpenseIds.length > 0) {
    const covered = await SharedExpense.find({
      _id: { $in: coveredExpenseIds },
      userId: req.userId,
      // Transfers can be cleared by a settle-all too: they already count in
      // the friend balance the client is settling.
      $and: [
        { $or: [{ isSettlement: false }, { isTransfer: true }] },
        { $or: [{ "splits.friendId": friendId }, { paidBy: friendId }] },
      ],
    }).select("_id paidBy splits totalAmount isSettlement");
    if (covered.length !== coveredExpenseIds.length) {
      res.status(400).json({
        success: false,
        message: "One or more expenses to settle were not found.",
      });
      return;
    }
    coveredIds = covered.map((c) => c._id as mongoose.Types.ObjectId);

    // Signed outstanding share per expense: positive = friend owes user,
    // negative = user owes friend. Same shared math as calculateNetBalance/
    // getBalances.
    const expectedSigned = covered.reduce(
      (sum, e) => sum + netBalanceContribution(e, friendId),
      0
    );
    // What the selected expenses must add up to: the money part plus the part forgiven.
    const submittedSigned = friendOwes ? amount + forgiven : -(amount + forgiven);
    if (Math.abs(expectedSigned - submittedSigned) > 0.01) {
      res.status(400).json({
        success: false,
        message: "Settlement amount doesn't match the selected expenses.",
      });
      return;
    }
  }

  const now = new Date();

  const session = await mongoose.startSession();
  let settlement: InstanceType<typeof SharedExpense> | null = null;
  try {
    await session.withTransaction(async () => {
      // The settlement SharedExpense cancels the debt in the balance math.
      // Its direction is set by paidBy: "user" reduces what the friend owes
      // you, the friendId reduces what you owe the friend.
      const docs = await SharedExpense.create(
        [
          {
            userId: req.userId,
            description: `Settlement with ${friend.name}`,
            totalAmount: amount,
            paidBy: friendOwes ? "user" : friendId,
            date: now,
            splits: [{ friendId, amount }],
            isSettlement: true,
            settlementMethod: method,
            coveredExpenseIds: coveredIds,
          },
        ],
        { session }
      );
      settlement = docs[0];

      // Reflect the real-world money movement as a Transaction (and account balance).
      if (method === "received") {
        // Friend paid you back — money lands in the chosen account.
        const categoryId = await getOrCreateCategory(
          req.userId!,
          "Settlement",
          "income"
        );
        await Transaction.create(
          [
            {
              userId: req.userId,
              type: "income",
              amount,
              categoryId,
              accountId,
              note: `Settlement from ${friend.name}`,
              date: now,
            },
          ],
          { session }
        );
        await Account.updateOne(
          { _id: accountId, userId: req.userId },
          { $inc: { balance: amount } },
          { session }
        );
      } else if (method === "paid") {
        // You paid the friend back — money leaves the chosen account.
        const categoryId = await getOrCreateCategory(
          req.userId!,
          "Settlement",
          "expense"
        );
        await Transaction.create(
          [
            {
              userId: req.userId,
              type: "expense",
              amount,
              categoryId,
              accountId,
              note: `Settlement to ${friend.name}`,
              date: now,
            },
          ],
          { session }
        );
        await Account.updateOne(
          { _id: accountId, userId: req.userId },
          { $inc: { balance: -amount } },
          { session }
        );
      } else if (method === "waived" && friendOwes) {
        // You forgave what the friend owed — you absorb it as your own spend.
        // No account moves (the original bill already left your account);
        // this is purely a budget/expense record.
        const categoryId = await getOrCreateCategory(
          req.userId!,
          "Waived",
          "expense"
        );
        await Transaction.create(
          [
            {
              userId: req.userId,
              type: "expense",
              amount,
              categoryId,
              personalShare: amount,
              note: `Waived debt for ${friend.name}`,
              date: now,
            },
          ],
          { session }
        );
      }
      // method === "waived" && !friendOwes: the friend forgave your debt.
      // Nothing moves and it isn't your income; the settlement record alone
      // clears it.

      // The forgiven rest of a partial payment: its own waived settlement, with
      // the same effects a plain waive has.
      if (forgiven > 0) {
        await SharedExpense.create(
          [
            {
              userId: req.userId,
              description: `Waived part of settlement with ${friend.name}`,
              totalAmount: forgiven,
              paidBy: friendOwes ? "user" : friendId,
              date: now,
              splits: [{ friendId, amount: forgiven }],
              isSettlement: true,
              settlementMethod: "waived",
              coveredExpenseIds: [],
            },
          ],
          { session }
        );
        if (friendOwes) {
          const categoryId = await getOrCreateCategory(req.userId!, "Waived", "expense");
          await Transaction.create(
            [
              {
                userId: req.userId,
                type: "expense",
                amount: forgiven,
                categoryId,
                personalShare: forgiven,
                note: `Waived debt for ${friend.name}`,
                date: now,
              },
            ],
            { session }
          );
        }
      }
    });
  } finally {
    await session.endSession();
  }

  res.status(201).json({ success: true, settlement });
}

/**
 * Money sent to / received from a friend outside any bill ("Send money",
 * "Got money"). Books the real money move (Transaction + account balance) and a
 * settlement SharedExpense flagged isTransfer, so the friend balance moves by
 * the same math as Settle Up: sending raises what they owe you, receiving
 * lowers it.
 *
 * `repaysTransferId` ties it to an earlier transfer in the opposite direction
 * (they pay back part of the 10K you sent), which is what lets the UI show a
 * transfer's repayments and what is still left.
 */
export async function createTransfer(
  req: Request,
  res: Response
): Promise<void> {
  const {
    friendId,
    direction,
    amount,
    accountId,
    date,
    note,
    repaysTransferId,
  }: {
    friendId: string;
    direction: "sent" | "received";
    amount: number;
    accountId: string;
    date?: string;
    note?: string;
    repaysTransferId?: string;
  } = req.body;

  const friend = await Friend.findOne({ _id: friendId, userId: req.userId });
  if (!friend) {
    res.status(404).json({ success: false, message: "Friend not found." });
    return;
  }

  const account = await Account.findOne({ _id: accountId, userId: req.userId });
  if (!account) {
    res.status(404).json({ success: false, message: "Account not found." });
    return;
  }

  const method = direction === "sent" ? "paid" : "received";

  if (repaysTransferId) {
    const original = await SharedExpense.findOne({
      _id: repaysTransferId,
      userId: req.userId,
      isTransfer: true,
      repaysTransferId: { $exists: false },
      "splits.friendId": friendId,
    });
    if (!original || original.settlementMethod === method) {
      res.status(400).json({
        success: false,
        message: "Transfer to repay not found.",
      });
      return;
    }
    const repaid = await SharedExpense.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          repaysTransferId: original._id,
        },
      },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    const left = original.totalAmount - (repaid[0]?.total ?? 0);
    if (amount > left + 0.01) {
      res.status(400).json({
        success: false,
        message: `Only ${Math.round(left * 100) / 100} is left to repay on that transfer.`,
      });
      return;
    }
  }

  const when = date ? new Date(date) : new Date();
  const label =
    note?.trim() ||
    (direction === "sent" ? `Sent to ${friend.name}` : `Received from ${friend.name}`);

  const session = await mongoose.startSession();
  let transfer: InstanceType<typeof SharedExpense> | null = null;
  try {
    await session.withTransaction(async () => {
      const categoryId = await getOrCreateCategory(
        req.userId!,
        "Friend transfer",
        direction === "sent" ? "expense" : "income"
      );
      const docs = await Transaction.create(
        [
          {
            userId: req.userId,
            type: direction === "sent" ? "expense" : "income",
            amount,
            categoryId,
            accountId,
            note: label,
            date: when,
          },
        ],
        { session }
      );
      await Account.updateOne(
        { _id: accountId, userId: req.userId },
        { $inc: { balance: direction === "sent" ? -amount : amount } },
        { session }
      );

      const created = await SharedExpense.create(
        [
          {
            userId: req.userId,
            transactionId: docs[0]._id,
            description: label,
            totalAmount: amount,
            paidBy: direction === "sent" ? friendId : "user",
            date: when,
            splits: [{ friendId, amount }],
            isSettlement: true,
            isTransfer: true,
            settlementMethod: method,
            repaysTransferId: repaysTransferId || undefined,
          },
        ],
        { session }
      );
      transfer = created[0];
    });
  } finally {
    await session.endSession();
  }

  res.status(201).json({ success: true, transfer });
}

export async function deleteSharedExpense(
  req: Request,
  res: Response
): Promise<void> {
  const expense = await SharedExpense.findOne({
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

  // A transfer owns its Transaction, so deleting it undoes the money move too.
  // Refused while repayments point at it, which would orphan them.
  if (expense.isTransfer) {
    const repayments = await SharedExpense.countDocuments({
      userId: req.userId,
      repaysTransferId: expense._id,
    });
    if (repayments > 0) {
      res.status(400).json({
        success: false,
        message: "Delete its repayments first.",
      });
      return;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const tx = expense.transactionId
          ? await Transaction.findOne({
              _id: expense.transactionId,
              userId: req.userId,
            }).session(session)
          : null;
        if (tx?.accountId) {
          await Account.updateOne(
            { _id: tx.accountId, userId: req.userId },
            { $inc: { balance: tx.type === "expense" ? tx.amount : -tx.amount } },
            { session }
          );
        }
        if (tx) await Transaction.deleteOne({ _id: tx._id }, { session });
        await SharedExpense.deleteOne({ _id: expense._id }, { session });
      });
    } finally {
      await session.endSession();
    }
    res.status(200).json({ success: true, message: "Transfer deleted." });
    return;
  }

  // Settlements move real money (see settleUp) via a separate Transaction /
  // account-balance change that isn't linked back to this record, so deleting
  // it here would silently desync the friend balance from the account balance
  // with no way to reverse it. Not currently exposed in the UI either way.
  if (expense.isSettlement) {
    res.status(400).json({
      success: false,
      message: "Settlements can't be deleted.",
    });
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await SharedExpense.deleteOne({ _id: expense._id }, { session });

      // If this split came from a regular Transaction (has transactionId),
      // that Transaction's personalShare still reflects the now-deleted
      // split. Reset it so the full amount counts toward the budget again —
      // mirrors what updateTransaction already does when a split is removed
      // via the edit form.
      if (expense.transactionId) {
        await Transaction.updateOne(
          { _id: expense.transactionId, userId: req.userId },
          { $unset: { personalShare: "" } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  res.status(200).json({ success: true, message: "Shared expense deleted." });
}
