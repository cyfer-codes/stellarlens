import { NextRequest, NextResponse } from "next/server";
import { listTransfers } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";

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
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
