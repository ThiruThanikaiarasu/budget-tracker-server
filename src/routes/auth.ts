import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  register,
  login,
  getMe,
  updatePreferences,
} from "../controllers/authController.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const router = Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.get("/me", authenticate, getMe);

const preferencesSchema = z.object({
  financialMonthStartDay: z.number().int().min(1).max(31),
});

router.put(
  "/preferences",
  authenticate,
  validate(preferencesSchema),
  updatePreferences
);

export default router;
