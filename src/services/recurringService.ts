import mongoose from "mongoose";
import { Account } from "../models/Account.js";
import { Category, type ICategory } from "../models/Category.js";
import { CategoryItem, type ICategoryItem } from "../models/CategoryItem.js";
import { Transaction } from "../models/Transaction.js";
import { nextOccurrence } from "../utils/recurring.js";

// A recurring source: the Category or CategoryItem that carries the schedule.
export type RecurringSource =
  | { kind: "item"; doc: ICategoryItem }
  | { kind: "category"; doc: ICategory };

// Most entries one source may add in a single run, so a long-forgotten
// schedule can't flood the ledger.
const MAX_CATCH_UP = 36;

const keyOf = (s: RecurringSource) => `${s.kind}:${s.doc._id}`;

export async function loadSources(userId: string): Promise<RecurringSource[]> {
  const [items, categories] = await Promise.all([
    CategoryItem.find({ userId, recurring: { $exists: true } }),
    Category.find({ userId, recurring: { $exists: true } }),
  ]);
  return [
    ...items.filter((d) => d.recurring).map((doc) => ({ kind: "item" as const, doc })),
    ...categories.filter((d) => d.recurring).map((doc) => ({ kind: "category" as const, doc })),
  ];
}

/** Move the schedule past `due`. Only advances if nobody else already did. */
async function advance(source: RecurringSource, due: Date): Promise<void> {
  const r = source.doc.recurring!;
  const next = nextOccurrence(due, r.frequency, r.startDate!);
  const Model = source.kind === "item" ? CategoryItem : Category;
  await (Model as typeof CategoryItem).updateOne(
    { _id: source.doc._id, "recurring.nextDue": due },
    { $set: { "recurring.nextDue": next } }
  );
  source.doc.recurring!.nextDue = next;
}

/**
 * Add the autopay entry for one due date: the Transaction and the account
 * balance move together. Returns "duplicate" when that date is already covered:
 * added before (the unique index keeps concurrent runs safe), or entered by hand
 * (same item, or same category for a whole-category schedule, same amount, same
 * day), in which case that entry is linked to the schedule instead.
 */
async function postEntry(
  userId: string,
  source: RecurringSource,
  due: Date
): Promise<"created" | "duplicate" | "no-account"> {
  const r = source.doc.recurring!;
  const account = await Account.findOne({ _id: r.accountId, userId });
  if (!account) return "no-account";

  const category =
    source.kind === "item"
      ? await Category.findById((source.doc as ICategoryItem).categoryId)
      : (source.doc as ICategory);
  if (!category) return "no-account";

  const type = category.type;
  const name = source.doc.name;
  const key = keyOf(source);

  // Already entered by hand that day? Link it rather than adding a second one.
  const dayEnd = new Date(due.getTime() + 24 * 60 * 60 * 1000);
  const manual = await Transaction.findOne({
    userId,
    recurringKey: { $exists: false },
    amount: r.amount,
    date: { $gte: due, $lt: dayEnd },
    ...(source.kind === "item" ? { "items.itemId": source.doc._id } : { categoryId: category._id }),
  });
  if (manual) {
    try {
      await Transaction.updateOne(
        { _id: manual._id },
        { $set: { recurringKey: key, recurringDue: due } }
      );
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
    return "duplicate";
  }
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Transaction.create(
        [
          {
            userId,
            type,
            amount: r.amount,
            categoryId: category._id,
            accountId: r.accountId,
            items:
              source.kind === "item"
                ? [{ itemId: source.doc._id, name, amount: r.amount }]
                : undefined,
            date: due,
            recurringKey: key,
            recurringDue: due,
          },
        ],
        { session }
      );
      await Account.updateOne(
        { _id: r.accountId },
        { $inc: { balance: type === "income" ? r.amount : -r.amount } },
        { session }
      );
    });
    return "created";
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return "duplicate";
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Autopay catch-up for one user: every autopay source that has fallen due gets
 * its missed entries added, oldest first, then moves on. Safe to call often.
 */
export async function runAutopay(userId: string): Promise<number> {
  const now = new Date();
  let created = 0;
  for (const source of await loadSources(userId)) {
    const r = source.doc.recurring!;
    if (!r.autopay || !r.nextDue || !r.startDate || !r.accountId) continue;
    for (let i = 0; i < MAX_CATCH_UP; i++) {
      const due = source.doc.recurring!.nextDue!;
      if (due > now) break;
      const result = await postEntry(userId, source, due);
      if (result === "no-account") break; // account deleted: leave it due
      if (result === "created") created++;
      await advance(source, due);
    }
  }
  return created;
}

/** Every user with an autopay source: the daily cron. */
export async function runAutopayForAll(): Promise<number> {
  const [itemUsers, categoryUsers] = await Promise.all([
    CategoryItem.distinct("userId", { "recurring.autopay": true }),
    Category.distinct("userId", { "recurring.autopay": true }),
  ]);
  const ids = new Set([...itemUsers, ...categoryUsers].map(String));
  let created = 0;
  for (const id of ids) created += await runAutopay(id);
  return created;
}
