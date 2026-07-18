import type { Request, Response } from "express";
import { MonthlyInvestmentBudget } from "../models/MonthlyInvestmentBudget.js";

/** Get the monthly investment budget for a month (defaults if never set). */
export async function getBudget(req: Request, res: Response): Promise<void> {
  const month = String(req.params.month);
  const doc = await MonthlyInvestmentBudget.findOne({ userId: req.userId, month });
  res.status(200).json({
    success: true,
    budget: doc ?? { month, budget: 0, invested: [] },
  });
}

/** Create or replace the monthly investment budget. Editable anytime. */
export async function upsertBudget(req: Request, res: Response): Promise<void> {
  const month = String(req.params.month);
  const { budget, invested } = req.body as {
    budget: number;
    invested: { type: string; amount: number }[];
  };

  const doc = await MonthlyInvestmentBudget.findOneAndUpdate(
    { userId: req.userId, month },
    { budget, invested },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  res.status(200).json({ success: true, budget: doc });
}
