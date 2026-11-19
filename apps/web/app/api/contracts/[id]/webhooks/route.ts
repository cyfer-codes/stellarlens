import { NextRequest, NextResponse } from "next/server";
import { createWebhook, listWebhooks } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);

  try {
    const webhooks = await listWebhooks(contractId);
    return NextResponse.json(webhooks);
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  const body = (await request.json().catch(() => ({}))) as { url?: string; eventTypes?: string[] };

  if (!body.url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const created = await createWebhook(contractId, { url: body.url, eventTypes: body.eventTypes });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
