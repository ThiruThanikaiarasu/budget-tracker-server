/**
 * Fill passedToFriendId / passedFrom on "Passed on" expenses made before those
 * fields existed. The Passing on panel wrote them into the note as
 * "From <who> → <friend>[ · note]"; the friend is matched by name.
 *
 *   npx tsx src/scripts/backfillPassedOn.ts          # dry run
 *   npx tsx src/scripts/backfillPassedOn.ts --apply  # write
 */
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { Friend } from "../models/Friend.js";
import { Transaction } from "../models/Transaction.js";

const apply = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const categories = await Category.find({ name: "Passed on", type: "expense" }).select("_id");
  const txs = await Transaction.find({
    categoryId: { $in: categories.map((c) => c._id) },
    passedToFriendId: { $exists: false },
  });

  for (const tx of txs) {
    const m = /^From (.+?) → (.+?)(?: · .*)?$/.exec(tx.note ?? "");
    if (!m) {
      console.log(`skip ${tx._id}: note "${tx.note}" isn't "From X → Y"`);
      continue;
    }
    const [, from, to] = m;
    const friend = await Friend.findOne({
      userId: tx.userId,
      name: new RegExp(`^${to.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
    if (!friend) {
      console.log(`skip ${tx._id}: no friend named "${to}"`);
      continue;
    }
    console.log(`${apply ? "set" : "would set"} ${tx._id}: ₹${tx.amount} from "${from}" → ${friend.name}`);
    if (apply) {
      await Transaction.updateOne(
        { _id: tx._id },
        { $set: { passedToFriendId: friend._id, passedFrom: from.trim() } }
      );
    }
  }
  console.log(`${txs.length} candidate(s)${apply ? "" : " (dry run, nothing written)"}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
