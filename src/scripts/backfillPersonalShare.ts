import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Transaction } from "../models/Transaction.js";
import { SharedExpense } from "../models/SharedExpense.js";

/**
 * One-time backfill for split transactions created before personalShare and
 * the transaction<->split link existed.
 *
 * Old split transactions stored the full amount and were never linked to their
 * auto-created SharedExpense, so the budget counted the whole bill and the edit
 * form couldn't load the split. We rebuild the link by matching each
 * non-settlement, unlinked SharedExpense to the transaction it came from:
 *   same userId, type "expense", same date, amount === totalAmount.
 *
 * For an unambiguous (exactly one) match we set:
 *   - Transaction.personalShare = totalAmount - sum(splits)   (if not already set)
 *   - SharedExpense.transactionId = transaction._id
 * Zero/multiple candidates are skipped and logged. Idempotent and safe to
 * re-run (already-linked splits are ignored).
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

  const expenses = await SharedExpense.find({
    isSettlement: false,
    transactionId: { $exists: false },
  });
  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — scanning ${expenses.length} unlinked shared expenses\n`
  );

  let linked = 0;
  let skippedNoMatch = 0;
  let skippedAmbiguous = 0;

  for (const exp of expenses) {
    const splitTotal = exp.splits.reduce((sum, s) => sum + s.amount, 0);
    const personalShare = round2(Math.max(0, exp.totalAmount - splitTotal));

    const candidates = await Transaction.find({
      userId: exp.userId,
      type: "expense",
      date: exp.date,
      amount: exp.totalAmount,
    });

    const label = `"${exp.description}" ${exp.totalAmount} on ${exp.date.toISOString().slice(0, 10)}`;

    if (candidates.length === 0) {
      skippedNoMatch++;
      console.log(`  SKIP (no match — manual split?): ${label}`);
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
    const needsShare = tx.personalShare == null;
    console.log(
      `  MATCH: ${label} -> tx ${tx._id} | link transactionId` +
        (needsShare ? ` + set personalShare ${personalShare}` : ` (personalShare already ${tx.personalShare})`)
    );

    if (APPLY) {
      await SharedExpense.updateOne(
        { _id: exp._id },
        { $set: { transactionId: tx._id } }
      );
      if (needsShare) {
        await Transaction.updateOne(
          { _id: tx._id },
          { $set: { personalShare } }
        );
      }
    }
    linked++;
  }

  console.log(
    `\nSummary: ${linked} ${APPLY ? "linked" : "would link"}, ` +
      `${skippedNoMatch} no-match, ${skippedAmbiguous} ambiguous.`
  );
  if (!APPLY && linked > 0) {
    console.log("Re-run with --apply to write these changes.");
  }

  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
