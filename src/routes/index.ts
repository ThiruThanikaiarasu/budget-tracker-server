import { Router } from "express";
import authRoutes from "./auth.js";
import accountRoutes from "./accounts.js";
import transferRoutes from "./transfers.js";
import categoryRoutes from "./categories.js";
import transactionRoutes from "./transactions.js";
import dashboardRoutes from "./dashboard.js";
import friendRoutes from "./friends.js";
import splitRoutes from "./splits.js";
import investmentRoutes from "./investments.js";
import snapshotRoutes from "./snapshots.js";
import targetRoutes from "./targets.js";
import budgetRoutes from "./budgets.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/accounts", accountRoutes);
router.use("/transfers", transferRoutes);
router.use("/categories", categoryRoutes);
router.use("/transactions", transactionRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/friends", friendRoutes);
router.use("/splits", splitRoutes);
router.use("/investments", investmentRoutes);
router.use("/snapshots", snapshotRoutes);
router.use("/targets", targetRoutes);
router.use("/budgets", budgetRoutes);

export default router;
