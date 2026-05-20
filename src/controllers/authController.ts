import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { env } from "../config/env.js";

function generateToken(userId: string): string {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: "7d" });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(409).json({
      success: false,
      message: "A user with this email already exists.",
    });
    return;
  }

  const user = await User.create({ email, password, name });
  const token = generateToken(String(user._id));

  res.status(201).json({
    success: true,
    token,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      financialMonthStartDay: user.financialMonthStartDay,
    },
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    res.status(401).json({
      success: false,
      message: "Invalid email or password.",
    });
    return;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    res.status(401).json({
      success: false,
      message: "Invalid email or password.",
    });
    return;
  }

  const token = generateToken(String(user._id));

  res.status(200).json({
    success: true,
    token,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      financialMonthStartDay: user.financialMonthStartDay,
    },
  });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.userId).select("-password");
  if (!user) {
    res.status(401).json({
      success: false,
      message: "User not found.",
    });
    return;
  }

  res.status(200).json({
    success: true,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      financialMonthStartDay: user.financialMonthStartDay,
      createdAt: user.createdAt,
    },
  });
}

export async function updatePreferences(
  req: Request,
  res: Response
): Promise<void> {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(401).json({ success: false, message: "User not found." });
    return;
  }

  const { financialMonthStartDay } = req.body;
  if (financialMonthStartDay !== undefined) {
    user.financialMonthStartDay = financialMonthStartDay;
  }

  await user.save();

  res.status(200).json({
    success: true,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      financialMonthStartDay: user.financialMonthStartDay,
    },
  });
}
