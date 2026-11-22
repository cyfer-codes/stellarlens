import { NextRequest, NextResponse } from "next/server";
import { updateContract } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  const body = (await request.json().catch(() => ({}))) as { name?: string | null };

  const name = typeof body.name === "string" ? body.name.trim() || null : null;

  try {
    const updated = await updateContract(contractId, { name });
    return NextResponse.json(updated);
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
