import type { Request, Response } from "express";
import { Investment } from "../models/Investment.js";

export async function createInvestment(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, amountInvested, currentValue, dateInvested, note } =
    req.body;

  const investment = await Investment.create({
    userId: req.userId,
    name,
    type,
    amountInvested,
    currentValue,
    dateInvested,
    note,
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
  const { name, type, amountInvested, currentValue, dateInvested, note } =
    req.body;

  const investment = await Investment.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { name, type, amountInvested, currentValue, dateInvested, note },
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
