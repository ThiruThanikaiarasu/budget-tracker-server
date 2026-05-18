import type { Request, Response } from "express";
import { Account } from "../models/Account.js";

export async function createAccount(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, balance, color } = req.body;

  const account = await Account.create({
    userId: req.userId,
    name,
    type,
    balance: balance ?? 0,
    color,
  });

  res.status(201).json({ success: true, account });
}

export async function getAccounts(
  req: Request,
  res: Response
): Promise<void> {
  const accounts = await Account.find({ userId: req.userId }).sort({
    createdAt: -1,
  });

  res.status(200).json({ success: true, accounts });
}

export async function getAccount(
  req: Request,
  res: Response
): Promise<void> {
  const account = await Account.findOne({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!account) {
    res.status(404).json({ success: false, message: "Account not found." });
    return;
  }

  res.status(200).json({ success: true, account });
}

export async function updateAccount(
  req: Request,
  res: Response
): Promise<void> {
  const { name, type, color } = req.body;

  const account = await Account.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { name, type, color },
    { new: true, runValidators: true }
  );

  if (!account) {
    res.status(404).json({ success: false, message: "Account not found." });
    return;
  }

  res.status(200).json({ success: true, account });
}

export async function toggleAccount(
  req: Request,
  res: Response
): Promise<void> {
  const account = await Account.findOne({
    _id: req.params.id,
    userId: req.userId,
  });

  if (!account) {
    res.status(404).json({ success: false, message: "Account not found." });
    return;
  }

  account.isActive = !account.isActive;
  await account.save();

  res.status(200).json({ success: true, account });
}
