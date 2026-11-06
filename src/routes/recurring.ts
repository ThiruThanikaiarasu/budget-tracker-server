import { Router } from "express";
import { authenticate } from "../middlewares/auth.js";
import {
  getRecurring,
  runRecurring,
  runRecurringCron,
} from "../controllers/recurringController.js";

const router = Router();

// Cron endpoint — guarded by CRON_SECRET inside the handler, no user auth.
router.get("/cron", runRecurringCron);

router.use(authenticate);
router.get("/", getRecurring);
router.post("/run", runRecurring);

export default router;
