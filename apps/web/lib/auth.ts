import { eq } from "drizzle-orm";
import { getDb, users, type UserRole } from "@stellarlens/db";
import { getSession } from "./session";

export interface CurrentUser {
  id: number;
  email: string;
  role: UserRole;
}

/** Resolves the full user row (including role) for the current session, if any. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const db = getDb();
  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, session.sub));

  return user ?? null;
}
