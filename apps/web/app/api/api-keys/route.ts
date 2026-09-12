import { NextRequest, NextResponse } from "next/server";
import { generateApiKey, listApiKeys } from "@/lib/apiKeys";

export async function GET() {
  try {
    const keys = await listApiKeys();
    return NextResponse.json(keys);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const created = await generateApiKey(body.name);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
