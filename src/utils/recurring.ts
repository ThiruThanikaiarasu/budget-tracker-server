import mongoose, { Schema } from "mongoose";
import { z } from "zod";
import { dateString } from "./zodDate.js";
import { Account } from "../models/Account.js";

/**
 * Recurring payment settings, shared by Category and CategoryItem (e.g. the
 * Apple Music item under Subscriptions, or the whole Rent category). Present =
 * recurring; absent = not.
 *
 * Plain recurring is just a marker with the usual amount: the user pays it
 * themselves, from whichever account that month. Only `autopay` carries a
 * schedule (startDate, nextDue, accountId), and the server adds the entry itself
 * when it falls due.
 */
export interface IRecurring {
  frequency: "monthly" | "yearly";
  amount: number;
  autopay: boolean;
  // Autopay only. First due date; also anchors the day of month (and month,
  // yearly), so a 31st doesn't drift to the 28th after a short month.
  startDate?: Date;
  // Autopay only. The next occurrence not yet added. Dates are UTC midnight,
  // like every transaction date the client sends ("YYYY-MM-DD").
  nextDue?: Date;
  // Autopay only. Where the money is taken from.
  accountId?: mongoose.Types.ObjectId;
}

export const recurringSubSchema = new Schema<IRecurring>(
  {
    frequency: { type: String, enum: ["monthly", "yearly"], required: true },
    amount: { type: Number, required: true, min: 0 },
    autopay: { type: Boolean, required: true, default: false },
    startDate: { type: Date },
    nextDue: { type: Date },
    accountId: { type: Schema.Types.ObjectId, ref: "Account" },
  },
  { _id: false }
);

/** undefined = leave as is, null = clear, object = set. */
export const recurringInput = z
  .object({
    frequency: z.enum(["monthly", "yearly"]),
    amount: z.number().positive(),
    autopay: z.boolean(),
    // Autopay only.
    startDate: dateString.optional(),
    accountId: z.string().min(1).optional(),
  })
  .refine((r) => !r.autopay || (!!r.startDate && !!r.accountId), {
    message: "Autopay needs a first payment date and an account.",
  })
  .nullable()
  .optional();

export type RecurringInput = z.infer<typeof recurringInput>;

const utcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The occurrence after `due`, keeping the anchor's day (clamped to short months). */
export function nextOccurrence(
  due: Date,
  frequency: "monthly" | "yearly",
  anchor: Date
): Date {
  const year = due.getUTCFullYear() + (frequency === "yearly" ? 1 : 0);
  const month =
    frequency === "yearly" ? anchor.getUTCMonth() : due.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)));
}

/**
 * Turn the request's `recurring` into what to store. `existing` lets an edit
 * that doesn't touch the start date keep its place in the schedule.
 */
export async function buildRecurring(
  userId: string,
  input: RecurringInput,
  existing?: IRecurring | null
): Promise<
  | { error: string }
  | { change: "keep" }
  | { change: "clear" }
  | { change: "set"; value: IRecurring }
> {
  if (input === undefined) return { change: "keep" };
  if (input === null) return { change: "clear" };

  // Plain recurring: a marker with the usual amount, no schedule.
  if (!input.autopay) {
    return {
      change: "set",
      value: { frequency: input.frequency, amount: input.amount, autopay: false },
    };
  }

  const account = await Account.findOne({ _id: input.accountId, userId });
  if (!account) return { error: "Account not found." };

  const startDate = utcDay(new Date(input.startDate!));
  const sameStart =
    existing?.autopay &&
    existing.startDate &&
    existing.nextDue &&
    utcDay(existing.startDate).getTime() === startDate.getTime();

  return {
    change: "set",
    value: {
      frequency: input.frequency,
      amount: input.amount,
      autopay: true,
      startDate,
      nextDue: sameStart ? existing!.nextDue : startDate,
      accountId: new mongoose.Types.ObjectId(input.accountId),
    },
  };
}
