import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin").$type<UserRole>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
