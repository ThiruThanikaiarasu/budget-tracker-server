import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  upsertBudget,
  getBudget,
  getMonthlySummary,
  getTodaySummary,
  precheck,
} from "../controllers/budgetController.js";

const monthRegex = /^\d{4}-\d{2}$/;

const upsertSchema = z.object({
  month: z.string().regex(monthRegex, "Month must be YYYY-MM"),
  overallLimit: z.number().positive().optional(),
  categoryBudgets: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        limit: z.number().positive(),
        frequency: z.enum(["daily", "monthly"]),
        carryForward: z.boolean().optional(),
      })
    )
    .optional(),
});

const precheckSchema = z.object({
  categoryId: z.string().optional(),
  amount: z.number().positive(),
  date: z.string().optional(),
});

const router = Router();

router.use(authenticate);

router.post("/", validate(upsertSchema), upsertBudget);
router.post("/precheck", validate(precheckSchema), precheck);
router.get("/today", getTodaySummary);
router.get("/:month", getBudget);
router.get("/:month/summary", getMonthlySummary);

export default router;
