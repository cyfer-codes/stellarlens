import { NextResponse } from "next/server";
import { deleteWebhook, sanitizeApiError } from "@/lib/api";

export async function DELETE(_request: Request, { params }: { params: { id: string; webhookId: string } }) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);

  try {
    await deleteWebhook(contractId, webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, message } = sanitizeApiError(err, `webhook ${webhookId}`);
    return NextResponse.json({ error: message }, { status });
  }
}
