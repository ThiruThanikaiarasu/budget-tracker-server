import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { seedDefaultCategories } from "./scripts/seedCategories.js";

async function start(): Promise<void> {
  await connectDB();
  await seedDefaultCategories();
  app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
