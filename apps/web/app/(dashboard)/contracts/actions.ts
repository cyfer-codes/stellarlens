"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createContract, listContracts, type ListContractsParams } from "@/lib/api";

export interface AddContractState {
  fieldErrors: Partial<Record<"address" | "network" | "name", string>>;
  formError?: string;
}

export const initialAddContractState: AddContractState = { fieldErrors: {} };

function getApiValidationMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "failed to register contract";
  const body = message.split(": ").at(-1);
  if (!body) {
    return message;
  }
  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    return Array.isArray(parsed.message) ? parsed.message.join(" ") : parsed.message ?? message;
  } catch {
    return message;
  }
}

export async function addContract(_prevState: AddContractState, formData: FormData): Promise<AddContractState> {
  const address = String(formData.get("address") ?? "").trim();
  const network = String(formData.get("network") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!address || !network) {
    return {
      fieldErrors: {
        ...(address ? {} : { address: "Address is required." }),
        ...(network ? {} : { network: "Network is required." })
      }
    };
  }

  try {
    await createContract({ address, network, name: name || undefined });
  } catch (err) {
    return { fieldErrors: { address: getApiValidationMessage(err) }, formError: "The contract could not be registered." };
  }

  revalidatePath("/contracts");
  redirect("/contracts");
}

export async function loadContracts(params: ListContractsParams) {
  return listContracts(params);
}