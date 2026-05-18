import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  createFriend,
  getFriends,
  updateFriend,
} from "../controllers/friendController.js";

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

const updateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

const router = Router();

router.use(authenticate);

router.post("/", validate(createSchema), createFriend);
router.get("/", getFriends);
router.put("/:id", validate(updateSchema), updateFriend);

export default router;
