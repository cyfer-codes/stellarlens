import { NextResponse } from "next/server";
import { getContractStats } from "@/lib/api";
import { sanitizeApiError } from "@/lib/apiError";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);

  try {
    const stats = await getContractStats(contractId);
    return NextResponse.json(stats);
  } catch (err) {
    const { status, error } = sanitizeApiError(err);
    return NextResponse.json({ error }, { status });
  }
}
