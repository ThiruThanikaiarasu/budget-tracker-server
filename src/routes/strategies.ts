import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getStrategies,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  getStrategyLinks,
  upsertStrategyLink,
  deleteStrategyLink,
} from "../controllers/strategyController.js";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  prompt: z.string().max(2000).optional(),
  expression: z.string().min(1).max(500),
  enabled: z.boolean().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    description: z.string().max(500).optional(),
    prompt: z.string().max(2000).optional(),
    expression: z.string().min(1).max(500).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Provide at least one field to update.",
  });

const linkSchema = z.object({
  params: z.record(z.string(), z.number()).optional(),
  enabled: z.boolean().optional(),
});

const router = Router();
router.use(authenticate);

router.get("/", getStrategies);
router.post("/", validate(createSchema), createStrategy);
router.put("/:id", validate(updateSchema), updateStrategy);
router.delete("/:id", deleteStrategy);

// Strategy ⇄ Domain links (per-domain params live here).
router.get("/:id/domains", getStrategyLinks);
router.put("/:id/domains/:domainId", validate(linkSchema), upsertStrategyLink);
router.delete("/:id/domains/:domainId", deleteStrategyLink);

export default router;
