import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getCategoryItems,
  createCategoryItem,
  updateCategoryItem,
  setCategoryItemsVisibility,
  getCategoryItemStats,
  getCategoryItemHistory,
  deleteCategoryItem,
} from "../controllers/categoryItemController.js";

const fields = {
  name: z.string().trim().min(1),
  unitGroupId: z.string().optional(),
  allowedUnitIds: z.array(z.string().min(1)).optional(),
  defaultUnitId: z.string().optional(),
  defaultQuantity: z.number().positive().optional(),
  presetOverrides: z
    .array(z.object({ unitId: z.string().min(1), values: z.array(z.number().positive()) }))
    .optional(),
};

const createSchema = z.object({ categoryId: z.string().min(1), ...fields });
const updateSchema = z.object(fields);
const visibilitySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  showInPicker: z.boolean(),
});

const router = Router();

router.use(authenticate);

router.get("/", getCategoryItems);
router.get("/stats", getCategoryItemStats);
router.get("/:id/history", getCategoryItemHistory);
router.post("/", validate(createSchema), createCategoryItem);
router.patch("/visibility", validate(visibilitySchema), setCategoryItemsVisibility);
router.put("/:id", validate(updateSchema), updateCategoryItem);
router.delete("/:id", deleteCategoryItem);

export default router;
