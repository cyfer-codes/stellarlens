import { NextRequest, NextResponse } from "next/server";
import { listTransfers } from "@/lib/api";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  const limitParam = request.nextUrl.searchParams.get("limit");
  const cursorParam = request.nextUrl.searchParams.get("cursor");

  try {
    const transfers = await listTransfers(contractId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: cursorParam ? Number(cursorParam) : undefined
    });
    return NextResponse.json(transfers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
