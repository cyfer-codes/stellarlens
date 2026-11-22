import { NextResponse } from "next/server";
import { getContractStatus } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    try {
        return NextResponse.json(await getContractStatus(Number(params.id)));
    } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : "unknown error" }, { status: 502 });
    }
}