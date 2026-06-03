import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Transaction } from "../models/Transaction.js";
import { SharedExpense } from "../models/SharedExpense.js";

/**
 * One-time backfill for split transactions created before personalShare existed.
 *
 * Old split transactions stored the full amount and were never linked to their
 * auto-created SharedExpense, so the budget counted the whole bill instead of
 * the user's share. We rebuild the link by matching each non-settlement
 * SharedExpense to the transaction it came from:
 *   same userId, type "expense", same date, amount === totalAmount,
 *   and personalShare not yet set.
 *
 * Only an unambiguous (exactly one) match is updated; zero/multiple candidates
 * are skipped and logged for manual review. Idempotent and non-destructive.
 *
 * Usage:
 *   npx tsx src/scripts/backfillPersonalShare.ts          # dry-run (no writes)
 *   npx tsx src/scripts/backfillPersonalShare.ts --apply  # apply updates
 */

const APPLY = process.argv.includes("--apply");

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function backfill(): Promise<void> {
  await connectDB();

  const expenses = await SharedExpense.find({ isSettlement: false });
  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — scanning ${expenses.length} non-settlement shared expenses\n`
  );

  let updated = 0;
  let skippedNoMatch = 0;
  let skippedAmbiguous = 0;
  let alreadyDone = 0;

  for (const exp of expenses) {
    const splitTotal = exp.splits.reduce((sum, s) => sum + s.amount, 0);
    const personalShare = round2(Math.max(0, exp.totalAmount - splitTotal));

    const candidates = await Transaction.find({
      userId: exp.userId,
      type: "expense",
      date: exp.date,
      amount: exp.totalAmount,
      personalShare: { $exists: false },
    });

    const label = `"${exp.description}" ${exp.totalAmount} on ${exp.date.toISOString().slice(0, 10)}`;

    if (candidates.length === 0) {
      // Could already be backfilled, or a manually-created split (no transaction).
      const already = await Transaction.countDocuments({
        userId: exp.userId,
        type: "expense",
        date: exp.date,
        amount: exp.totalAmount,
        personalShare: { $exists: true },
      });
      if (already > 0) {
        alreadyDone++;
      } else {
        skippedNoMatch++;
        console.log(`  SKIP (no match): ${label}`);
      }
      continue;
    }

    if (candidates.length > 1) {
      skippedAmbiguous++;
      console.log(
        `  SKIP (${candidates.length} candidates — review manually): ${label}`
      );
      continue;
    }

    const tx = candidates[0]!;
    console.log(
      `  MATCH: ${label} -> tx ${tx._id} | amount ${tx.amount} -> personalShare ${personalShare}`
    );

    if (APPLY) {
      await Transaction.updateOne(
        { _id: tx._id },
        { $set: { personalShare } }
      );
    }
    updated++;
  }

  console.log(
    `\nSummary: ${updated} ${APPLY ? "updated" : "would update"}, ` +
      `${skippedNoMatch} no-match, ${skippedAmbiguous} ambiguous, ` +
      `${alreadyDone} already backfilled.`
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
