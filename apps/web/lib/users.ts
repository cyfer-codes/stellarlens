import { eq, sql } from "drizzle-orm";
import { getDb, users, USER_ROLES, type UserRole } from "@stellarlens/db";
import { hashPassword, verifyPassword } from "./password";

export interface UserRow {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export async function listUsers(): Promise<UserRow[]> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.createdAt);

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export type CreateUserResult = { status: "ok"; user: UserRow } | { status: "duplicate_email" };

export async function createUser(email: string, password: string, role: UserRole): Promise<CreateUserResult> {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail));
  if (existing) {
    return { status: "duplicate_email" };
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(users)
    .values({ email: normalizedEmail, passwordHash, role })
    .returning({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt });

  return { status: "ok", user: { ...created, createdAt: created.createdAt.toISOString() } };
}

export type DeleteUserResult = "ok" | "not_found" | "last_user";

export async function deleteUser(id: number): Promise<DeleteUserResult> {
  const db = getDb();

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count <= 1) {
    return "last_user";
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!existing) {
    return "not_found";
  }

  await db.delete(users).where(eq(users.id, id));
  return "ok";
}

export type ChangePasswordResult = "ok" | "invalid_current_password" | "not_found";

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    return "not_found";
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return "invalid_current_password";
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  return "ok";
}
