"use client";

import { useFormState } from "react-dom";
import { StrKey } from "@stellar/stellar-sdk";
import { addContract, initialAddContractState } from "@/app/(dashboard)/contracts/actions";

export function AddContractForm() {
  const [state, formAction] = useFormState(addContract, initialAddContractState);

  return (
    <form action={formAction} className="max-w-sm space-y-3">
      <div>
        <label htmlFor="address" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Address
        </label>
        <input
          id="address"
          name="address"
          required
          placeholder="G... or C..."
          onChange={(event) => {
            const value = event.target.value.trim();
            event.target.setCustomValidity(
              value && !StrKey.isValidContract(value) ? "Enter a valid Stellar contract address." : ""
            );
          }}
          className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
        />
        {state.fieldErrors.address && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{state.fieldErrors.address}</p>}
      </div>
      <div>
        <label htmlFor="network" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Network
        </label>
        <input
          id="network"
          name="network"
          required
          defaultValue="testnet"
          className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm"
        />
        {state.fieldErrors.network && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{state.fieldErrors.network}</p>}
      </div>
      {state.formError && <p className="text-sm text-red-600 dark:text-red-400">{state.formError}</p>}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Name <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <input id="name" name="name" className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" />
      </div>
      <button
        type="submit"
        className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm font-medium text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
      >
        Register contract
      </button>
    </form>
  );
}
