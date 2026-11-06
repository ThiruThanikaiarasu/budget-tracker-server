import { Router } from "express";
import { authenticate } from "../middlewares/auth.js";
import {
  getSummary,
  getCategoryBreakdown,
  getMonthlyTrend,
  getMonthAnalysis,
} from "../controllers/dashboardController.js";

const router = Router();

router.use(authenticate);

router.get("/summary", getSummary);
router.get("/category-breakdown", getCategoryBreakdown);
router.get("/monthly-trend", getMonthlyTrend);
router.get("/month-analysis", getMonthAnalysis);

export default router;
