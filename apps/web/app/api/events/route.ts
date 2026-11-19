import { NextRequest, NextResponse } from "next/server";
import { listRecentEvents } from "@/lib/api";

export async function GET(request: NextRequest) {
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    try {
        return NextResponse.json(await listRecentEvents(limit));
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 502 });
    }
}