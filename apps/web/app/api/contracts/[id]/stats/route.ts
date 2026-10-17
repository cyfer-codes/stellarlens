import { NextResponse } from "next/server";
import { ApiNotFoundError, getContractStats } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const contractId = Number(params.id);

  try {
    const stats = await getContractStats(contractId);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof ApiNotFoundError) {
      return NextResponse.json({ error: `contract ${contractId} not found` }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
