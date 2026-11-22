import { NextResponse } from "next/server";
import {
  ApiBadRequestError,
  ApiConflictError,
  ApiNotFoundError,
  deleteWebhook,
  updateWebhook
} from "@/lib/api";
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

export async function PATCH(request: Request, { params }: { params: { id: string; webhookId: string } }) {
  const contractId = Number(params.id);
  const webhookId = Number(params.webhookId);

  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    eventTypes?: string[];
  };

  if (body.url === undefined && body.eventTypes === undefined) {
    return NextResponse.json({ error: "url or eventTypes is required" }, { status: 400 });
  }

  try {
    const updated = await updateWebhook(contractId, webhookId, {
      url: body.url,
      eventTypes: body.eventTypes
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      return NextResponse.json({ error: `webhook ${webhookId} not found` }, { status: 404 });
    }
    if (err instanceof ApiConflictError) {
      return NextResponse.json({ error: err.message || "url already in use for this contract" }, { status: 409 });
    }
    if (err instanceof ApiBadRequestError) {
      return NextResponse.json({ error: err.message || "invalid input" }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}