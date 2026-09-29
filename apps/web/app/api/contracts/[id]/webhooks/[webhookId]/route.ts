import { NextResponse } from "next/server";
import { ApiNotFoundError, deleteWebhook } from "@/lib/api";

export async function DELETE(_request: Request, { params }: { params: { id: string; webhookId: string } }) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);

  try {
    await deleteWebhook(contractId, webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      return NextResponse.json({ error: `webhook ${webhookId} not found` }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
