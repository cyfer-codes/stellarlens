import { NextRequest, NextResponse } from "next/server";
import { listWebhookDeliveries } from "@/lib/api";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; webhookId: string } }
) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);
  if (Number.isNaN(contractId) || Number.isNaN(webhookId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const cursorParam = request.nextUrl.searchParams.get("cursor");

  try {
    const page = await listWebhookDeliveries(contractId, webhookId, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor: cursorParam ? Number(cursorParam) : undefined
    });
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}