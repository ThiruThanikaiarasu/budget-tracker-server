import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Domain } from "../models/Domain.js";
import { Strategy } from "../models/Strategy.js";
import { StrategyDomain } from "../models/StrategyDomain.js";
import { parseExpression } from "../services/strategyEvaluator.js";

/**
 * Seed wishlist strategies + their domain links for a user. Backend-only path
 * for adding strategies (no UI yet): the user describes a rule, we add it here.
 * Idempotent — upserts by name, safe to re-run.
 *
 * Usage:
 *   npx tsx src/scripts/seedStrategies.ts --email=you@mail.com            # dry-run
 *   npx tsx src/scripts/seedStrategies.ts --email=you@mail.com --apply    # write
 */

const APPLY = process.argv.includes("--apply");
const emailArg = process.argv.find((a) => a.startsWith("--email="));
const EMAIL = emailArg ? emailArg.split("=")[1] : "";

interface SeedStrategy {
  name: string;
  description: string;
  prompt: string;
  expression: string;
  /** Per-domain params for the link to `domain`. */
  params: Record<string, number>;
  /** Asset-class domain name this strategy hooks onto (created if missing). */
  domain: string;
}

// Gold buy-zone strategies (sourced from technical-analysis guidance; all
// computable from Zerodha price + historical-derived sma50/sma200/high52).
const SEED: SeedStrategy[] = [
  {
    name: "Above 200-DMA",
    description: "Structural uptrend filter — price above its 200-day average.",
    prompt: "green when gold is trading above its 200-day moving average (structural bull market)",
    expression: "price > sma200",
    params: {},
    domain: "gold",
  },
  {
    name: "50-DMA pullback",
    description: "Low-risk re-entry — price has pulled back to near/below the 50-day average.",
    prompt: "green when price has dipped to within a small band of its 50-day moving average",
    expression: "price <= sma50 * (1 + band)",
    params: { band: 0.02 },
    domain: "gold",
  },
  {
    name: "10% below 52w high",
    description: "Buy-the-dip — price is a meaningful distance below its 52-week high.",
    prompt: "green when price is at least 10% below its 52-week high",
    expression: "price < high52 * pullback",
    params: { pullback: 0.9 },
    domain: "gold",
  },
];

async function run(): Promise<void> {
  if (!EMAIL) {
    console.error("Pass --email=<your login email>.");
    process.exit(1);
  }

  await connectDB();
  const user = await User.findOne({ email: EMAIL });
  if (!user) {
    console.error(`No user found with email ${EMAIL}.`);
    process.exit(1);
  }

  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — seeding ${SEED.length} strategies for ${EMAIL}\n`
  );

  // Cache domain ids as we ensure them (avoids re-querying per strategy).
  const domainCache = new Map<string, string>();

  async function ensureDomain(name: string): Promise<string> {
    const cached = domainCache.get(name);
    if (cached) return cached;
    let domain = await Domain.findOne({ userId: user!._id, name });
    if (!domain && APPLY) {
      domain = await Domain.create({
        userId: user!._id,
        name,
        kind: "asset_class",
      });
    }
    const id = domain ? String(domain._id) : "(new)";
    domainCache.set(name, id);
    return id;
  }

  for (const s of SEED) {
    // Validate the formula up front so a typo fails loudly, not silently.
    let variables: string[];
    try {
      variables = parseExpression(s.expression);
    } catch (err) {
      console.error(`  SKIP ${s.name} — invalid formula: ${(err as Error).message}`);
      continue;
    }

    const domainId = await ensureDomain(s.domain);
    const paramStr = Object.entries(s.params)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(
      `  ${s.name.padEnd(22)} ${s.expression.padEnd(30)} → ${s.domain}` +
        (paramStr ? `  [${paramStr}]` : "") +
        `  vars: ${variables.join(", ")}`
    );

    if (!APPLY) continue;

    const strategy = await Strategy.findOneAndUpdate(
      { userId: user._id, name: s.name },
      {
        $set: {
          description: s.description,
          prompt: s.prompt,
          expression: s.expression,
          variables,
          enabled: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await StrategyDomain.findOneAndUpdate(
      { userId: user._id, strategyId: strategy._id, domainId },
      { $set: { params: s.params, enabled: true } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  console.log(
    APPLY
      ? `\nDone. Seeded ${SEED.length} strategies + gold links.\n`
      : `\nDry-run only. Re-run with --apply to write.\n`
  );
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
