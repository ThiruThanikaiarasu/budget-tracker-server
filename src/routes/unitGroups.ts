import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getUnitGroups,
  createUnitGroup,
  updateUnitGroup,
  deleteUnitGroup,
} from "../controllers/unitGroupController.js";

const groupSchema = z.object({
  name: z.string().trim().min(1),
  units: z.array(
    z.object({
      _id: z.string().optional(),
      name: z.string().trim().min(1),
      factor: z.number().positive(),
      presets: z.array(z.number().positive()).optional(),
    })
  ),
});

const router = Router();

router.use(authenticate);

router.get("/", getUnitGroups);
router.post("/", validate(groupSchema), createUnitGroup);
router.put("/:id", validate(groupSchema), updateUnitGroup);
router.delete("/:id", deleteUnitGroup);

export default router;
