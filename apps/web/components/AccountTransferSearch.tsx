"use client";

import { StrKey } from "@stellar/stellar-sdk";

export function AccountTransferSearch({ address = "" }: { address?: string }) {
    return (
        <form method="get" className="flex max-w-2xl gap-2">
            <label htmlFor="account-address" className="sr-only">Account address</label>
            <input
                id="account-address"
                name="address"
                defaultValue={address}
                required
                placeholder="G... account address"
                onChange={(event) => event.currentTarget.setCustomValidity(
                    !event.currentTarget.value || StrKey.isValidEd25519PublicKey(event.currentTarget.value.trim())
                        ? ""
                        : "Enter a valid Stellar account address."
                )}
                className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 font-mono text-sm"
            />
            <button type="submit" className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">Search</button>
        </form>
    );
}