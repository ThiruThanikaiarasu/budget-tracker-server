import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  toggleAccount,
} from "../controllers/accountController.js";

const accountTypes = ["cash", "bank_account", "credit_card", "upi_wallet", "other"] as const;

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(accountTypes),
  balance: z.number().optional(),
  color: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(accountTypes),
  color: z.string().optional(),
});

const router = Router();

router.use(authenticate);

router.post("/", validate(createSchema), createAccount);
router.get("/", getAccounts);
router.get("/:id", getAccount);
router.put("/:id", validate(updateSchema), updateAccount);
router.patch("/:id/toggle", toggleAccount);

export default router;
