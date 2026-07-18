import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { getAnalysis, upsertAnalysis } from "../controllers/stockAnalysisController.js";

const upsertSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.enum(["NSE", "BSE"]),
  name: z.string().min(1),
  currentPrice: z.number().min(0).optional(),
  fundamentals: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  priceSeries: z
    .array(z.object({ date: z.string().min(1), close: z.number() }))
    .optional(),
  source: z.string().optional(),
});

const router = Router();

router.use(authenticate);

router.get("/:symbol", getAnalysis);
router.post("/", validate(upsertSchema), upsertAnalysis);

export default router;
