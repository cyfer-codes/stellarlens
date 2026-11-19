"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { getSession, revokeUserSessions } from "@/lib/session-server";

export async function logout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await revokeUserSessions(session.sub);
  }
  cookies().delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
