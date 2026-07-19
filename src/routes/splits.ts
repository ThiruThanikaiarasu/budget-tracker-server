import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { dateString } from "../utils/zodDate.js";
import {
  createSharedExpense,
  getSharedExpenses,
  getBalances,
  settleUp,
  deleteSharedExpense,
} from "../controllers/splitController.js";

const createSchema = z.object({
  description: z.string().min(1),
  totalAmount: z.number().positive(),
  paidBy: z.string().min(1),
  date: dateString.optional(),
  splits: z
    .array(
      z.object({
        friendId: z.string().min(1),
        amount: z.number().min(0),
      })
    )
    .min(1),
});

const settleSchema = z
  .object({
    friendId: z.string().min(1),
    amount: z.number().positive(),
    method: z.enum(["received", "paid", "waived"]),
    friendOwes: z.boolean(),
    accountId: z.string().min(1).optional(),
    coveredExpenseIds: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (d) => d.method === "waived" || !!d.accountId,
    { message: "accountId is required when money changes hands.", path: ["accountId"] }
  );

const router = Router();

router.use(authenticate);

router.post("/", validate(createSchema), createSharedExpense);
router.get("/", getSharedExpenses);
router.get("/balances", getBalances);
router.post("/settle", validate(settleSchema), settleUp);
router.delete("/:id", deleteSharedExpense);

export default router;
