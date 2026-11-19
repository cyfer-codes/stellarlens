import { NextRequest, NextResponse } from "next/server";
import { generateApiKey, listApiKeys } from "@/lib/apiKeys";
import { sanitizeApiError } from "@/lib/api";

export async function GET() {
  try {
    const keys = await listApiKeys();
    return NextResponse.json(keys);
  } catch (err) {
    const { status, message } = sanitizeApiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: string };
    const created = await generateApiKey(body.name);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const { status, message } = sanitizeApiError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
