import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/lib/api";
import { notFound } from "next/navigation";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  if (Number.isNaN(contractId)) {
    notFound();
  }
  const limitParam = request.nextUrl.searchParams.get("limit");
  const cursorParam = request.nextUrl.searchParams.get("cursor");
  const topic = request.nextUrl.searchParams.get("topic") ?? undefined;
  const topics = request.nextUrl.searchParams.get("topics")?.split(",").filter(Boolean);
  const from = request.nextUrl.searchParams.get("from") ?? undefined;
  const to = request.nextUrl.searchParams.get("to") ?? undefined;

  try {
    const events = await listEvents(contractId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: cursorParam ? Number(cursorParam) : undefined,
      topic,
      topics,
      from,
      to
    });
    return NextResponse.json(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
