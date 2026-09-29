import { Parser } from "expr-eval";

/**
 * Safe evaluation of user-defined Strategy formulas.
 *
 * Formulas are stored as expr-eval expression strings and evaluated against a
 * scope of resolved numbers. `allowMemberAccess: false` means an expression can
 * only reference the variables we hand it — it can never reach JS globals,
 * prototypes, or run arbitrary code. This is the reason we never touch `eval`.
 */
const parser = new Parser({ allowMemberAccess: false });

export type StrategyStatus = "green" | "red" | "no_data";

export interface EvaluationResult {
  status: StrategyStatus;
  /** Variables the formula needs but the scope didn't supply. */
  missing: string[];
  /** Raw formula result (present only when status is green/red). */
  value?: number | boolean;
}

/**
 * Validate an expression and return the variable names it references.
 * Throws if the expression is syntactically invalid — callers use this at
 * strategy-create/update time to reject bad formulas and to store `variables`.
 */
export function parseExpression(expression: string): string[] {
  return parser.parse(expression).variables({ withMembers: false });
}

/** True when a scope value is usable as a formula input. */
function isUsable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Evaluate one strategy formula against a scope. Any referenced variable that is
 * absent / non-finite makes the result `no_data` (grey — excluded from the
 * green/red split) rather than silently coercing to a wrong verdict.
 */
export function evaluateExpression(
  expression: string,
  scope: Record<string, number>
): EvaluationResult {
  let expr;
  try {
    expr = parser.parse(expression);
  } catch {
    // A malformed stored formula is treated as "no data" for that item rather
    // than crashing the whole dashboard.
    return { status: "no_data", missing: [] };
  }

  const needed = expr.variables({ withMembers: false });
  const missing = needed.filter((name) => !isUsable(scope[name]));
  if (missing.length > 0) {
    return { status: "no_data", missing };
  }

  const value = expr.evaluate(scope) as number | boolean;
  return { status: value ? "green" : "red", missing: [], value };
}

/**
 * Aggregate a set of statuses into green/red percentages. `no_data` results are
 * excluded from the denominator (they can't be a considerable/not verdict), but
 * are counted separately so the UI can show "n unknown".
 */
export function aggregate(statuses: StrategyStatus[]): {
  green: number;
  red: number;
  noData: number;
  greenPct: number;
  redPct: number;
} {
  const green = statuses.filter((s) => s === "green").length;
  const red = statuses.filter((s) => s === "red").length;
  const noData = statuses.filter((s) => s === "no_data").length;
  const scored = green + red;
  return {
    green,
    red,
    noData,
    greenPct: scored ? Math.round((green / scored) * 100) : 0,
    redPct: scored ? Math.round((red / scored) * 100) : 0,
  };
}
