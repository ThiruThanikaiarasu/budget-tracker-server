import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { User } from "../models/User.js";
import { normalizeName } from "../utils/normalizeName.js";

/**
 * Add expense categories to one user's account — same rules as the app's
 * "Add New Category": skips names the user can already see (case- and
 * space-insensitive) and appends new ones to the end of their category order.
 *
 * Usage:
 *   npx tsx src/scripts/addCategories.ts --user "<name or email>"          # dry-run
 *   npx tsx src/scripts/addCategories.ts --user "<name or email>" --apply  # write
 */

const APPLY = process.argv.includes("--apply");
const userArg = process.argv[process.argv.indexOf("--user") + 1];

const NEW_CATEGORIES = [
  { name: "Workspace", type: "expense", icon: "computer" },
  { name: "Books", type: "expense", icon: "book" },
  { name: "Learning", type: "expense", icon: "education" },
] as const;

async function run(): Promise<void> {
  await connectDB();

  if (!process.argv.includes("--user") || !userArg) {
    const users = await User.find().select("name email");
    console.log("Pass --user with one of:");
    users.forEach((u) => console.log(`  ${u.name} <${u.email}>`));
    return;
  }

  const rx = new RegExp(userArg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matches = await User.find({ $or: [{ name: rx }, { email: rx }] });
  if (matches.length !== 1) {
    console.log(`"${userArg}" matched ${matches.length} users — be more specific.`);
    matches.forEach((u) => console.log(`  ${u.name} <${u.email}>`));
    return;
  }
  const user = matches[0];
  console.log(`User: ${user.name} <${user.email}>  ${APPLY ? "(APPLY)" : "(dry-run)"}`);

  const hiddenIds = user.hiddenCategoryIds.map((id) => id.toString());
  for (const cat of NEW_CATEGORIES) {
    const visible = await Category.find({
      $or: [{ userId: null }, { userId: user._id }],
      _id: { $nin: hiddenIds },
      type: cat.type,
    }).select("name");
    const clash = visible.find((c) => normalizeName(c.name) === normalizeName(cat.name));
    if (clash) {
      console.log(`  skip   ${cat.name} — "${clash.name}" already exists`);
      continue;
    }
    if (!APPLY) {
      console.log(`  would add  ${cat.name} (${cat.type}, icon ${cat.icon})`);
      continue;
    }
    const created = await Category.create({ userId: user._id, ...cat });
    await User.updateOne({ _id: user._id }, { $push: { categoryOrder: created._id } });
    console.log(`  added  ${cat.name}`);
  }
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
