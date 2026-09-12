import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb, users } from "@stellarlens/db";
import { hashPassword } from "../lib/password";

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@stellarlens.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    console.error("SEED_ADMIN_PASSWORD environment variable is required");
    process.exit(1);
  }

  const db = createDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

  if (existing) {
    console.log(`admin user ${email} already exists, skipping`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({ email, passwordHash });
  console.log(`created admin user ${email}`);
  process.exit(0);
}

main();
