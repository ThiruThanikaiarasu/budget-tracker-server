import { Router } from "express";
import { authenticate } from "../middlewares/auth.js";
import {
  getSnapshots,
  createSnapshot,
  runScheduledSnapshots,
} from "../controllers/snapshotController.js";

const router = Router();

// Cron endpoint — guarded by CRON_SECRET inside the handler, no user auth.
router.get("/cron", runScheduledSnapshots);

router.use(authenticate);
router.get("/", getSnapshots);
router.post("/", createSnapshot);

export default router;
