"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createDb, users } from "@stellarlens/db";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/session";

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "email and password are required" };
  }

  const db = createDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "invalid email or password" };
  }

  const token = await createSessionToken(user.id, user.sessionVersion);
  cookies().set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  redirect("/contracts");
}
