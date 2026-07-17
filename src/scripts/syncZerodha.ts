import fs from "fs";
import path from "path";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Investment, type InvestmentType, type Exchange } from "../models/Investment.js";
import { createSnapshotForUser } from "../services/snapshotService.js";

/**
 * MCP-driven Zerodha sync. The Kite MCP runs in the assistant session, so the
 * assistant fetches holdings + the NIFTY 50 level, writes them to a JSON payload
 * file, and runs this script to (1) upsert holdings and (2) take a portfolio
 * snapshot stamped with the Nifty level (for the benchmark comparison).
 *
 * Payload file (default src/scripts/zerodha-latest.json):
 *   {
 *     "fetchedAt": "2026-07-17T...",
 *     "niftyLevel": 24680.9,
 *     "holdings": [
 *       { "type": "stocks", "symbol": "SBIN", "exchange": "BSE", "name": "...",
 *         "sector": "Financial Services", "quantity": 2, "avgBuyPrice": 949.6,
 *         "currentPrice": 1044.1 }, ...
 *     ]
 *   }
 *
 * Usage:
 *   npx tsx src/scripts/syncZerodha.ts --email=you@mail.com                 # dry-run
 *   npx tsx src/scripts/syncZerodha.ts --email=you@mail.com --apply         # apply
 *   npx tsx src/scripts/syncZerodha.ts --email=you@mail.com --file=path.json
 */

const APPLY = process.argv.includes("--apply");
const emailArg = process.argv.find((a) => a.startsWith("--email="));
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const EMAIL = emailArg ? emailArg.split("=")[1] : "";
const FILE = fileArg
  ? fileArg.split("=")[1]
  : path.join(process.cwd(), "src/scripts/zerodha-latest.json");

interface PayloadHolding {
  type: InvestmentType;
  name: string;
  symbol?: string;
  exchange?: Exchange;
  sector?: string;
  quantity: number;
  avgBuyPrice: number;
  currentPrice: number;
}
interface Payload {
  fetchedAt?: string;
  niftyLevel?: number;
  holdings: PayloadHolding[];
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function run(): Promise<void> {
  if (!EMAIL) {
    console.error("Pass --email=<your login email>.");
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) {
    console.error(`Payload file not found: ${FILE}`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(FILE, "utf-8")) as Payload;

  await connectDB();
  const user = await User.findOne({ email: EMAIL });
  if (!user) {
    console.error(`No user found with email ${EMAIL}.`);
    process.exit(1);
  }

  console.log(
    `\n${APPLY ? "APPLY" : "DRY-RUN"} — syncing ${payload.holdings.length} holdings for ${EMAIL}` +
      (payload.niftyLevel ? ` · NIFTY 50 ${payload.niftyLevel}` : " · no Nifty level") +
      "\n"
  );

  let created = 0;
  let updated = 0;

  for (const h of payload.holdings) {
    const amountInvested = round2(h.quantity * h.avgBuyPrice);
    const currentValue = round2(h.quantity * h.currentPrice);

    const match: Record<string, unknown> = { userId: user._id, type: h.type };
    if (h.symbol) match.symbol = h.symbol;
    else match.name = h.name;

    const existing = await Investment.findOne(match);
    const fields = {
      userId: user._id,
      name: h.name,
      type: h.type,
      symbol: h.symbol,
      exchange: h.exchange,
      sector: h.sector,
      quantity: h.quantity,
      avgBuyPrice: h.avgBuyPrice,
      currentPrice: h.currentPrice,
      currency: "INR",
      amountInvested,
      currentValue,
    };

    console.log(
      `  ${existing ? "UPDATE" : "CREATE"} ${(h.symbol || h.name).padEnd(34)} inv ${amountInvested}  cur ${currentValue}`
    );

    if (!APPLY) continue;
    if (existing) {
      existing.set(fields);
      await existing.save();
      updated++;
    } else {
      await Investment.create({ ...fields, dateInvested: new Date() });
      created++;
    }
  }

  if (APPLY) {
    const snap = await createSnapshotForUser(user._id, "manual", {
      benchmarkSymbol: payload.niftyLevel ? "NIFTY 50" : undefined,
      benchmarkLevel: payload.niftyLevel,
    });
    console.log(
      `\nDone. Created ${created}, updated ${updated}. Snapshot ${snap._id} ` +
        `(value ${snap.totalCurrent}${payload.niftyLevel ? `, Nifty ${payload.niftyLevel}` : ""}).\n`
    );
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write + snapshot.\n`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
