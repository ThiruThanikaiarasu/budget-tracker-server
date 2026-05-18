import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || "5000", 10),
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/budget-tracker",
  JWT_SECRET: process.env.JWT_SECRET || "default_jwt_secret_change_me",
} as const;
