import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createUser, isUserRole, listUsers } from "@/lib/users";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const users = await listUsers();
    return NextResponse.json(users);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string; role?: string };
  const email = body.email?.trim();
  const password = body.password;
  const role = body.role ?? "member";

  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (!isUserRole(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  try {
    const result = await createUser(email, password, role);
    if (result.status === "duplicate_email") {
      return NextResponse.json({ error: "a user with that email already exists" }, { status: 409 });
    }
    return NextResponse.json(result.user, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
