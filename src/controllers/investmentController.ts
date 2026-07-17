import type { Request, Response } from "express";
import { Investment } from "../models/Investment.js";

// Holdings-mode fields the client may send.
const HOLDING_FIELDS = [
  "symbol",
  "exchange",
  "sector",
  "quantity",
  "avgBuyPrice",
  "currentPrice",
  "currency",
] as const;

/**
 * Build the persisted document fields from a request body, deriving
 * amountInvested / currentValue from quantity * price when the holding is
 * tracked in holdings mode (quantity + prices present). Falls back to the
 * explicit amounts for lump-sum holdings (FD, PPF, gold, real estate, etc.).
 */
function buildInvestmentFields(body: any) {
  const { name, type, dateInvested, note } = body;

  const fields: Record<string, unknown> = { name, type, dateInvested, note };

  for (const key of HOLDING_FIELDS) {
    if (body[key] !== undefined) fields[key] = body[key];
  }

  const { quantity, avgBuyPrice, currentPrice } = body;
  const hasHoldingAmounts =
    quantity !== undefined && quantity !== null && avgBuyPrice !== undefined;

  if (hasHoldingAmounts) {
    fields.amountInvested = quantity * avgBuyPrice;
    fields.currentValue =
      currentPrice !== undefined && currentPrice !== null
        ? quantity * currentPrice
        : quantity * avgBuyPrice;
  } else {
    fields.amountInvested = body.amountInvested;
    fields.currentValue =
      body.currentValue !== undefined
        ? body.currentValue
        : body.amountInvested;
  }

  return fields;
}

export async function createInvestment(
  req: Request,
  res: Response
): Promise<void> {
  const investment = await Investment.create({
    userId: req.userId,
    ...buildInvestmentFields(req.body),
  });

  res.status(201).json({ success: true, investment });
}

export async function getInvestments(
  req: Request,
  res: Response
): Promise<void> {
  const investments = await Investment.find({ userId: req.userId }).sort({
    createdAt: -1,
  });

  res.status(200).json({ success: true, investments });
}

export async function updateInvestment(
  req: Request,
  res: Response
): Promise<void> {
  const investment = await Investment.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    buildInvestmentFields(req.body),
    { new: true, runValidators: true }
  );

  if (!investment) {
    res
      .status(404)
      .json({ success: false, message: "Investment not found." });
    return;
  }

  res.status(200).json({ success: true, investment });
}

export async function toggleInvestment(
  req: Request,
  res: Response
): Promise<void> {
  const investment = await Investment.findOne({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!investment) {
    res
      .status(404)
      .json({ success: false, message: "Investment not found." });
    return;
  }

  investment.isActive = !investment.isActive;
  await investment.save();

  res.status(200).json({ success: true, investment });
}
