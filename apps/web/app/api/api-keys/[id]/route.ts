import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/apiKeys";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const found = await revokeApiKey(Number(params.id));
    if (!found) {
      return NextResponse.json({ error: `api key ${params.id} not found` }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
