import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { changePassword } from "@/lib/users";

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "current and new password are required" }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `new password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }

  try {
    const result = await changePassword(currentUser.id, currentPassword, newPassword);
    if (result === "invalid_current_password") {
      return NextResponse.json({ error: "current password is incorrect" }, { status: 400 });
    }
    if (result === "not_found") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
