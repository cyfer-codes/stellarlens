import { NextResponse } from "next/server";
import { deleteWebhook } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";

export async function DELETE(_request: Request, { params }: { params: { id: string; webhookId: string } }) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);

  try {
    await deleteWebhook(contractId, webhookId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
