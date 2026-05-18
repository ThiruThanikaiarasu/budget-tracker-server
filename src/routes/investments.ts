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
  "mutual_fund",
  "stocks",
  "fd",
  "ppf",
  "gold",
  "real_estate",
  "crypto",
  "other",
] as const;

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(investmentTypes),
  amountInvested: z.number().min(0),
  currentValue: z.number().min(0),
  dateInvested: z.string().min(1),
  note: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(investmentTypes),
  amountInvested: z.number().min(0),
  currentValue: z.number().min(0),
  dateInvested: z.string().min(1),
  note: z.string().optional(),
});

const router = Router();

router.use(authenticate);

router.post("/", validate(createSchema), createInvestment);
router.get("/", getInvestments);
router.put("/:id", validate(updateSchema), updateInvestment);
router.patch("/:id/toggle", toggleInvestment);

export default router;
