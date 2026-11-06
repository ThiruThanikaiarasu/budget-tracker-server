import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { dateString } from "../utils/zodDate.js";
import {
  createTransaction,
  getTransactions,
  getTransactionsSummary,
  getMerchantSuggestions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  cleanupAccounts,
  setTransactionTag,
  getTags,
} from "../controllers/transactionController.js";

// "transfer" is deliberately excluded — transfers must go through POST /transfers,
// which validates ownership, active status, and sufficient balance on both
// accounts. The client never sends type: "transfer" here (its transaction
// form only offers income/expense, and edit is disabled for transfers).
const transactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  toAccountId: z.string().optional(),
  note: z.string().optional(),
  merchant: z.string().trim().max(80).optional(),
  date: dateString,
  paidByFriendId: z.string().optional(),
  receivedFromFriendId: z.string().optional(),
  // "Passed on" entries: who it went to and who it came from.
  passedToFriendId: z.string().optional(),
  passedFrom: z.string().trim().max(60).optional(),
  splits: z
    .array(
      z.object({
        friendId: z.string().min(1),
        amount: z.number().min(0),
      })
    )
    .optional(),
  // Itemised breakdown (sub-category items). See ITransactionItem.
  items: z
    .array(
      z.object({
        itemId: z.string().optional(),
        name: z.string().trim().min(1),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
        unitId: z.string().optional(),
        baseQuantity: z.number().min(0).optional(),
        amount: z.number().min(0),
        categoryId: z.string().optional(),
        sharedWith: z.array(z.string().min(1)).optional(),
      })
    )
    .optional(),
  charges: z
    .array(z.object({ label: z.string().trim().min(1), amount: z.number(), categoryId: z.string().optional(), bill: z.boolean().optional() }))
    .optional(),
});

const cleanupSchema = z.object({
  balances: z
    .array(
      z.object({
        accountId: z.string().min(1),
        newBalance: z.number(),
      })
    )
    .min(1),
});

// Join an existing group (tagId), find-or-create one by name (+ optional month),
// or send neither to clear the tag.
const tagSchema = z.object({
  tagId: z.string().min(1).optional(),
  name: z.string().trim().max(40).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const router = Router();

router.use(authenticate);

router.post("/cleanup", validate(cleanupSchema), cleanupAccounts);
router.post("/", validate(transactionSchema), createTransaction);
router.get("/", getTransactions);
router.get("/summary", getTransactionsSummary);
router.get("/merchants", getMerchantSuggestions);
router.get("/tags", getTags);
router.get("/:id", getTransaction);
router.put("/:id", validate(transactionSchema), updateTransaction);
router.patch("/:id/tag", validate(tagSchema), setTransactionTag);
router.delete("/:id", deleteTransaction);

export default router;
