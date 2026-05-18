import { Category } from "../models/Category.js";

const defaultCategories = [
  { name: "Food", type: "expense" as const },
  { name: "Transport", type: "expense" as const },
  { name: "Rent", type: "expense" as const },
  { name: "Bills", type: "expense" as const },
  { name: "Shopping", type: "expense" as const },
  { name: "Entertainment", type: "expense" as const },
  { name: "Health", type: "expense" as const },
  { name: "Education", type: "expense" as const },
  { name: "Other", type: "expense" as const },
  { name: "Salary", type: "income" as const },
  { name: "Freelance", type: "income" as const },
  { name: "Investment Return", type: "income" as const },
  { name: "Gift", type: "income" as const },
  { name: "Other", type: "income" as const },
];

export async function seedDefaultCategories(): Promise<void> {
  const existing = await Category.countDocuments({ userId: null });

  if (existing > 0) {
    console.log("Default categories already seeded — skipping.");
    return;
  }

  const docs = defaultCategories.map((cat) => ({
    userId: null,
    name: cat.name,
    type: cat.type,
  }));

  await Category.insertMany(docs);
  console.log(`Seeded ${docs.length} default categories.`);
}
