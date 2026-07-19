import type { ISharedExpense } from "../models/SharedExpense.js";

/**
 * One SharedExpense's contribution to a friend's net balance.
 * Positive = friend owes the user more; negative = user owes the friend more.
 *
 * Single source of truth for this math — friendController.calculateNetBalance
 * and splitController.getBalances both call this per expense instead of each
 * maintaining their own copy of the branching logic (see DOMAIN.md's checklist
 * item on keeping these in sync).
 */
export function netBalanceContribution(
  expense: ISharedExpense,
  friendId: string
): number {
  const friendSplit = expense.splits.find(
    (s) => s.friendId.toString() === friendId
  );

  if (expense.isSettlement) {
    if (!friendSplit) return 0;
    if (expense.paidBy === "user") return -friendSplit.amount;
    if (expense.paidBy.toString() === friendId) return friendSplit.amount;
    return 0;
  }

  if (expense.paidBy === "user") {
    return friendSplit ? friendSplit.amount : 0;
  }
  if (expense.paidBy.toString() === friendId) {
    const totalFriendSplits = expense.splits.reduce((sum, s) => sum + s.amount, 0);
    const userShare = expense.totalAmount - totalFriendSplits;
    return -userShare;
  }
  return 0;
}
