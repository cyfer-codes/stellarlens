import { NextRequest, NextResponse } from "next/server";
import { listAccountTransfers } from "@/lib/api";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (!params.address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await listAccountTransfers(params.address, {
      cursor: params.cursor ? Number(params.cursor) : undefined,
      limit: params.limit ? Number(params.limit) : undefined
    }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 502 });
  }
}