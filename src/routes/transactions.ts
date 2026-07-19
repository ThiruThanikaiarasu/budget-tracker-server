import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  createTransaction,
  getTransactions,
  getTransaction,
  updateTransaction,
  deleteTransaction,
  cleanupAccounts,
} from "../controllers/transactionController.js";

const transactionSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  amount: z.number().positive(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  toAccountId: z.string().optional(),
  note: z.string().optional(),
  date: z.string().min(1),
  paidByFriendId: z.string().optional(),
  splits: z
    .array(
      z.object({
        friendId: z.string().min(1),
        amount: z.number().min(0),
      })
    )
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

const router = Router();

router.use(authenticate);

router.post("/cleanup", validate(cleanupSchema), cleanupAccounts);
router.post("/", validate(transactionSchema), createTransaction);
router.get("/", getTransactions);
router.get("/:id", getTransaction);
router.put("/:id", validate(transactionSchema), updateTransaction);
router.delete("/:id", deleteTransaction);

export default router;
