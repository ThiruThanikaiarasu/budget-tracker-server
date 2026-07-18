import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { getBudget, upsertBudget } from "../controllers/investmentBudgetController.js";

const upsertSchema = z.object({
  budget: z.number().min(0),
  invested: z
    .array(z.object({ type: z.string().min(1), amount: z.number().min(0) }))
    .default([]),
});

const router = Router();

router.use(authenticate);

router.get("/:month", getBudget);
router.put("/:month", validate(upsertSchema), upsertBudget);

export default router;
