import type { PipelineStage } from "mongoose";

/**
 * Aggregation stages that fan a transaction out into one `alloc` row per
 * category it touches, so category reports can `$group` on `$alloc.categoryId`
 * and `$sum` `$alloc.amount`.
 *
 * - A line item may carry its own `categoryId`; one without it belongs to the
 *   transaction's category.
 * - Fees/discounts follow the same rule: their own `categoryId`, else the
 *   transaction's category.
 * - A charge marked `bill` applies to the whole bill (delivery, tax, coupon):
 *   it is spread across the categories in proportion to their amounts.
 * - Amounts are the user's share: `personalShare` when the bill was split,
 *   otherwise `amount` — each row is scaled by `personalShare / amount`.
 * - A transaction with no category overrides yields a single row, so old
 *   transactions report exactly as before.
 */
const lineCategory = (path: string) => ({ $ifNull: [`$$${path}.categoryId`, "$categoryId"] });
const notBill = { $ne: ["$$c.bill", true] };

export const categoryAllocationStages: PipelineStage[] = [
  {
    $addFields: {
      _ratio: {
        $cond: [
          { $gt: ["$amount", 0] },
          { $divide: [{ $ifNull: ["$personalShare", "$amount"] }, "$amount"] },
          1,
        ],
      },
      // Sum of whole-bill fees/discounts.
      _bill: {
        $sum: {
          $map: {
            input: { $ifNull: ["$charges", []] },
            as: "c",
            in: { $cond: [{ $eq: ["$$c.bill", true] }, "$$c.amount", 0] },
          },
        },
      },
      _hasOverride: {
        $anyElementTrue: [
          {
            $map: {
              input: { $concatArrays: [{ $ifNull: ["$items", []] }, { $ifNull: ["$charges", []] }] },
              as: "l",
              in: { $ne: [lineCategory("l"), "$categoryId"] },
            },
          },
        ],
      },
    },
  },
  {
    // The rows before any whole-bill share is added.
    $addFields: {
      _rows: {
        $cond: [
          "$_hasOverride",
          {
            $concatArrays: [
              {
                $map: {
                  input: { $ifNull: ["$items", []] },
                  as: "i",
                  in: { categoryId: lineCategory("i"), amount: "$$i.amount" },
                },
              },
              {
                $map: {
                  input: { $filter: { input: { $ifNull: ["$charges", []] }, as: "c", cond: notBill } },
                  as: "c",
                  in: { categoryId: lineCategory("c"), amount: "$$c.amount" },
                },
              },
            ],
          },
          [{ categoryId: "$categoryId", amount: { $ifNull: ["$personalShare", "$amount"] } }],
        ],
      },
    },
  },
  {
    $addFields: {
      _base: { $sum: "$_rows.amount" },
    },
  },
  {
    $addFields: {
      alloc: {
        $map: {
          input: "$_rows",
          as: "r",
          in: {
            categoryId: "$$r.categoryId",
            amount: {
              $cond: [
                "$_hasOverride",
                {
                  // scale each row so the whole-bill amount is shared in proportion
                  $multiply: [
                    "$$r.amount",
                    "$_ratio",
                    { $cond: [{ $ne: ["$_base", 0] }, { $divide: [{ $add: ["$_base", "$_bill"] }, "$_base"] }, 1] },
                  ],
                },
                "$$r.amount",
              ],
            },
          },
        },
      },
    },
  },
  { $unwind: "$alloc" },
];
