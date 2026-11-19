import { NextResponse } from "next/server";
import { ApiNotFoundError, rotateWebhookSecret } from "@/lib/api";

export async function POST(
  _request: Request,
  { params }: { params: { id: string; webhookId: string } }
) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);
  if (Number.isNaN(contractId) || Number.isNaN(webhookId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const rotated = await rotateWebhookSecret(contractId, webhookId);
    return NextResponse.json(rotated);
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      return NextResponse.json({ error: `webhook ${webhookId} not found` }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}