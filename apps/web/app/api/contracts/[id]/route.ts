import { NextRequest, NextResponse } from "next/server";
import { sanitizeApiError, updateContract } from "@/lib/api";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);
  const body = (await request.json().catch(() => ({}))) as { name?: string | null };

  const name = typeof body.name === "string" ? body.name.trim() || null : null;

  try {
    const updated = await updateContract(contractId, { name });
    return NextResponse.json(updated);
  } catch (err) {
    const { status, message } = sanitizeApiError(err, `contract ${contractId}`);
    return NextResponse.json({ error: message }, { status });
  }
}
