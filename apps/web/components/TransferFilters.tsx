"use client";

import { StrKey } from "@stellar/stellar-sdk";

export interface TransferFilterValues {
    asset?: string;
    from?: string;
    to?: string;
    minAmount?: string;
    maxAmount?: string;
}

function validateAddress(event: React.ChangeEvent<HTMLInputElement>, kind: "account" | "contract") {
    const value = event.target.value.trim();
    const valid = !value || (kind === "account" ? StrKey.isValidEd25519PublicKey(value) : StrKey.isValidContract(value));
    event.target.setCustomValidity(valid ? "" : `Enter a valid Stellar ${kind} address.`);
}

export function TransferFilters({ values }: { values: TransferFilterValues }) {
    return (
        <form method="get" className="grid gap-3 rounded border border-gray-200 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm text-gray-700">
                Asset
                <input name="asset" defaultValue={values.asset} onChange={(event) => validateAddress(event, "contract")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs" placeholder="C..." />
            </label>
            <label className="text-sm text-gray-700">
                From
                <input name="from" defaultValue={values.from} onChange={(event) => validateAddress(event, "account")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs" placeholder="G..." />
            </label>
            <label className="text-sm text-gray-700">
                To
                <input name="to" defaultValue={values.to} onChange={(event) => validateAddress(event, "account")} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs" placeholder="G..." />
            </label>
            <label className="text-sm text-gray-700">
                Minimum amount
                <input name="minAmount" inputMode="decimal" defaultValue={values.minAmount} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-sm text-gray-700">
                Maximum amount
                <input name="maxAmount" inputMode="decimal" defaultValue={values.maxAmount} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <div className="sm:col-span-2 lg:col-span-5">
                <button type="submit" className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">Apply filters</button>
            </div>
        </form>
    );
}