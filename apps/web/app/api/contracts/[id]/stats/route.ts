import { NextResponse } from "next/server";
import { getContractStats, sanitizeApiError } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);

  try {
    const stats = await getContractStats(contractId);
    return NextResponse.json(stats);
  } catch (err) {
    const { status, message } = sanitizeApiError(err, `contract ${contractId}`);
    return NextResponse.json({ error: message }, { status });
  }
}
