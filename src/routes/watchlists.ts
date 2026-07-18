import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate.js";
import { authenticate } from "../middlewares/auth.js";
import {
  getWatchlists,
  createWatchlist,
  updateWatchlist,
  deleteWatchlist,
  addItem,
  updateItem,
  removeItem,
  updatePrices,
} from "../controllers/watchlistController.js";

const exchanges = ["NSE", "BSE"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    color: z.string().optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined || d.order !== undefined, {
    message: "Provide at least one field to update.",
  });

const addItemSchema = z.object({
  symbol: z.string().min(1).max(30),
  exchange: z.enum(exchanges),
  name: z.string().min(1),
  instrumentToken: z.number().optional(),
  targetBuyPrice: z.number().min(0).optional(),
  notes: z.string().optional(),
});

const updateItemSchema = z
  .object({
    name: z.string().min(1).optional(),
    targetBuyPrice: z.number().min(0).optional(),
    notes: z.string().optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.targetBuyPrice !== undefined || d.notes !== undefined,
    { message: "Provide at least one field to update." }
  );

const pricesSchema = z.object({
  prices: z
    .array(
      z.object({
        symbol: z.string().min(1),
        exchange: z.string().optional(),
        price: z.number().min(0),
      })
    )
    .min(1),
});

const router = Router();

router.use(authenticate);

router.get("/", getWatchlists);
router.post("/", validate(createSchema), createWatchlist);
router.post("/prices", validate(pricesSchema), updatePrices);
router.put("/:id", validate(updateSchema), updateWatchlist);
router.delete("/:id", deleteWatchlist);
router.post("/:id/items", validate(addItemSchema), addItem);
router.put("/:id/items/:itemId", validate(updateItemSchema), updateItem);
router.delete("/:id/items/:itemId", removeItem);

export default router;
