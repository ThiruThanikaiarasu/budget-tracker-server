import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  createInvestment,
  getInvestments,
  updateInvestment,
  toggleInvestment,
} from "../controllers/investmentController.js";

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

const exchanges = ["NSE", "BSE", "NASDAQ", "NYSE", "other"] as const;

const investmentSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(investmentTypes),
    dateInvested: z.string().min(1),
    note: z.string().optional(),
    // Holdings-mode fields
    symbol: z.string().optional(),
    exchange: z.enum(exchanges).optional(),
    sector: z.string().optional(),
    quantity: z.number().min(0).optional(),
    avgBuyPrice: z.number().min(0).optional(),
    currentPrice: z.number().min(0).optional(),
    currency: z.string().optional(),
    // Lump-sum amounts (optional — derived from qty*price in holdings mode)
    amountInvested: z.number().min(0).optional(),
    currentValue: z.number().min(0).optional(),
  })
  .refine(
    (data) =>
      (data.quantity !== undefined && data.avgBuyPrice !== undefined) ||
      data.amountInvested !== undefined,
    {
      message:
        "Provide either quantity + avgBuyPrice (holdings) or amountInvested (lump-sum).",
      path: ["amountInvested"],
    }
  );

const router = Router();

router.use(authenticate);

router.post("/", validate(investmentSchema), createInvestment);
router.get("/", getInvestments);
router.put("/:id", validate(investmentSchema), updateInvestment);
router.patch("/:id/toggle", toggleInvestment);

export default router;
