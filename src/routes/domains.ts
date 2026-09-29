import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getDomains,
  createDomain,
  updateDomain,
  deleteDomain,
} from "../controllers/domainController.js";

const kinds = ["asset_class", "sector"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(kinds).optional(),
  parent: z.string().optional(),
  color: z.string().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    kind: z.enum(kinds).optional(),
    parent: z.string().nullable().optional(),
    color: z.string().optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update.",
  });

const router = Router();
router.use(authenticate);

router.get("/", getDomains);
router.post("/", validate(createSchema), createDomain);
router.put("/:id", validate(updateSchema), updateDomain);
router.delete("/:id", deleteDomain);

export default router;
