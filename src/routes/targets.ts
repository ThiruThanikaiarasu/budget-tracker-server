import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { getTargets, updateTargets } from "../controllers/targetController.js";

const investmentTypes = [
  "stocks",
  "index_fund",
  "mutual_fund",
  "us_stock",
  "bond",
  "fd",
  "ppf",
  "gold",
  "real_estate",
  "crypto",
  "other",
] as const;

const updateSchema = z.object({
  targets: z
    .array(
      z.object({
        type: z.enum(investmentTypes),
        pct: z.number().min(0).max(100),
      })
    )
    .max(11),
});

const router = Router();

router.use(authenticate);
router.get("/", getTargets);
router.put("/", validate(updateSchema), updateTargets);

export default router;
