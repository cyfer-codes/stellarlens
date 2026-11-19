import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteUser } from "@/lib/users";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await deleteUser(Number(params.id));
    if (result === "not_found") {
      return NextResponse.json({ error: `user ${params.id} not found` }, { status: 404 });
    }
    if (result === "last_user") {
      return NextResponse.json({ error: "the last remaining user can't be removed" }, { status: 409 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
