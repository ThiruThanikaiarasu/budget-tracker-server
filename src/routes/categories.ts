import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "../controllers/categoryController.js";

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense"]),
  icon: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense"]),
  icon: z.string().optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string()),
});

const router = Router();

router.use(authenticate);

router.get("/", getCategories);
router.post("/", validate(createSchema), createCategory);
router.patch("/reorder", validate(reorderSchema), reorderCategories);
router.put("/:id", validate(updateSchema), updateCategory);
router.delete("/:id", deleteCategory);

export default router;
