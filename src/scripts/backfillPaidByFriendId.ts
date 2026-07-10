import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Transaction } from "../models/Transaction.js";
import { SharedExpense } from "../models/SharedExpense.js";

/**
 * One-time backfill for transactions created before `paidByFriendId` was added
 * to the Transaction model.
 *
 * Old friend-paid transactions stored the payer only in `SharedExpense.paidBy`.
 * The edit form and the Debt chip read `Transaction.paidByFriendId` now, so those
 * old records show "Paid by: You" incorrectly.
 *
 * This script finds every SharedExpense where `paidBy !== 'user'` and the linked
 * transaction exists but has no `paidByFriendId` set, then copies the value over.
 *
 * Safe to re-run — already-set fields are skipped.
 *
 * Usage:
 *   npx tsx src/scripts/backfillPaidByFriendId.ts          # dry-run (no writes)
 *   npx tsx src/scripts/backfillPaidByFriendId.ts --apply  # apply updates
 */

const APPLY = process.argv.includes("--apply");

async function backfill(): Promise<void> {
  await connectDB();

  // Find all SharedExpenses where a friend paid and there is a linked transaction.
  const expenses = await SharedExpense.find({
    isSettlement: false,
    transactionId: { $exists: true },
    paidBy: { $ne: "user" },
  });

  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — scanning ${expenses.length} friend-paid shared expenses\n`
  );

  let updated = 0;
  let alreadySet = 0;
  let noTx = 0;

  for (const exp of expenses) {
    const tx = await Transaction.findById(exp.transactionId);
    if (!tx) {
      noTx++;
      console.log(
        `  SKIP (transaction not found): SharedExpense ${exp._id} transactionId ${exp.transactionId}`
      );
      continue;
    }

    if (tx.paidByFriendId != null) {
      alreadySet++;
      continue;
    }

    const friendId = exp.paidBy as mongoose.Types.ObjectId;
    console.log(
      `  SET: tx ${tx._id} "${exp.description}" ${exp.totalAmount} — paidByFriendId = ${friendId}`
    );

    if (APPLY) {
      await Transaction.updateOne(
        { _id: tx._id },
        { $set: { paidByFriendId: friendId } }
      );
    }
    updated++;
  }

  console.log(
    `\nSummary: ${updated} ${APPLY ? "updated" : "would update"}, ${alreadySet} already set, ${noTx} missing transaction.`
  );
  if (!APPLY && updated > 0) {
    console.log("Re-run with --apply to write these changes.");
  }

  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
