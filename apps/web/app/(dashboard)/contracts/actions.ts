"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createContract, listContracts, type ListContractsParams } from "@/lib/api";

export async function addContract(formData: FormData): Promise<void> {
  const address = String(formData.get("address") ?? "").trim();
  const network = String(formData.get("network") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!address || !network) {
    throw new Error("address and network are required");
  }

  await createContract({ address, network, name: name || undefined });

  revalidatePath("/contracts");
  redirect("/contracts");
}

export async function loadContracts(params: ListContractsParams) {
  return listContracts(params);
}