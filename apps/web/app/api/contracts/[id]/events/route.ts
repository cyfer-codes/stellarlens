import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";
import { notFound } from "next/navigation";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  if (Number.isNaN(contractId)) {
    notFound();
  }
  const limitParam = request.nextUrl.searchParams.get("limit");
  const cursorParam = request.nextUrl.searchParams.get("cursor");

  try {
    const events = await listEvents(contractId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: cursorParam ? Number(cursorParam) : undefined
    });
    return NextResponse.json(events);
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
