import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { createDb, users } from "@stellarlens/db";
import { SESSION_COOKIE_NAME, type SessionPayload, verifySessionToken } from "@/lib/session";

/** Server-side revocation is deliberately separate so Edge middleware remains HMAC-only and fast. */
export async function getSession(): Promise<SessionPayload | null> {
    const token = cookies().get(SESSION_COOKIE_NAME)?.value;
    const payload = token ? await verifySessionToken(token) : null;
    if (!payload) {
        return null;
    }

    const db = createDb();
    const [user] = await db.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, payload.sub));
    return user && user.sessionVersion === payload.sessionVersion ? payload : null;
}

export async function revokeUserSessions(userId: number): Promise<void> {
    const db = createDb();
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
}