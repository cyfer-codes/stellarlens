import { NextRequest, NextResponse } from "next/server";
import { generateApiKey, listApiKeys, type ApiKeyScope } from "@/lib/apiKeys";

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
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      scope?: ApiKeyScope;
      expiresAt?: string | null;
    };
    const created = await generateApiKey({
      name: body.name,
      scope: body.scope,
      expiresAt: body.expiresAt
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
