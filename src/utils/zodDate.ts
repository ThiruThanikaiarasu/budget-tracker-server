import { z } from "zod";

/**
 * A date string that must actually parse to a real date (rejects things like
 * "not-a-date"), without constraining the format the way z.string().datetime()
 * would — the client sends plain "YYYY-MM-DD" strings, not full ISO datetimes.
 */
export const dateString = z
  .string()
  .min(1)
  .refine((v) => !isNaN(Date.parse(v)), { message: "Invalid date." });
