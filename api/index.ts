import { connectDB } from "../src/config/db.js";
import { seedDefaultCategories } from "../src/scripts/seedCategories.js";
import { app } from "../src/app.js";

let isConnected = false;

async function init() {
  if (!isConnected) {
    await connectDB();
    await seedDefaultCategories();
    isConnected = true;
  }
}

export default async function handler(req: any, res: any) {
  await init();
  return app(req, res);
}
