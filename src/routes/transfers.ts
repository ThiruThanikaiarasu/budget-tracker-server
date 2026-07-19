import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import { dateString } from "../utils/zodDate.js";
import { createTransfer } from "../controllers/transferController.js";

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().positive(),
  note: z.string().optional(),
  date: dateString.optional(),
});

const router = Router();

router.use(authenticate);

router.post("/", validate(transferSchema), createTransfer);

export default router;
