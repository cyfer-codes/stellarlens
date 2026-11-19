export interface Contract {
  id: number;
  address: string;
  name: string | null;
  network: string;
}

export interface ListContractsParams {
  /** Return contracts with an id greater than this (pass the previous page's `nextCursor`). */
  cursor?: number;
  /** Page size, 1–100 (api default 20). */
  limit?: number;
  /** Case-insensitive substring match on the contract name. */
  name?: string;
  /** Exact match on network, e.g. "testnet". */
  network?: string;
}

export interface RegisterContractInput {
  address: string;
  network: string;
  name?: string;
}

export interface DecodedEventData {
  id: string;
  type: string;
  ledgerClosedAt: string;
  inSuccessfulContractCall: boolean;
  raw: {
    topic: string[];
    value: string;
  };
  decoded: {
    topic: unknown[];
    value: unknown;
  };
}

export interface EventRecord {
  id: number;
  contractId: number;
  ledger: number;
  txHash: string;
  topic: string;
  decodedData: DecodedEventData | null;
  createdAt: string;
}

export interface ListEventsParams {
  cursor?: number;
  limit?: number;
  topic?: string;
  from?: string;
  to?: string;
}

export interface WatchEventsOptions {
  /** How long to wait between polls once caught up, in ms. Defaults to 5000. */
  intervalMs?: number;
  /** Stops the watch: the iterator finishes (without throwing) and any in-flight request is aborted. */
  signal?: AbortSignal;
  /**
   * Where to start. `"latest"` skips every existing event and yields only ones indexed after the watch starts; a
   * number yields events with an id greater than it (e.g. the last id you processed). Omit to replay from the
   * contract's first event.
   */
  startAt?: "latest" | number;
  /** Only watch events whose first topic matches. */
  topic?: string;
  /** Page size per request (1–100). Defaults to 100. */
  limit?: number;
  /** Upper bound for the error backoff, in ms. Defaults to 60000. */
  maxBackoffMs?: number;
  /**
   * Called when a poll fails, before backing off. The watch keeps going: the delay doubles from `intervalMs` on
   * each consecutive failure (capped at `maxBackoffMs`) and resets after the next success.
   */
  onError?: (error: unknown, info: { attempt: number; retryInMs: number }) => void;
}

export interface TransferRecord {
  id: number;
  contractId: number;
  from: string;
  to: string;
  amount: string;
  asset: string;
  txHash: string;
  ledger: number;
  createdAt: string;
}

export interface ListTransfersParams {
  cursor?: number;
  limit?: number;
}

export interface GetStatsParams {
  from?: string;
  to?: string;
}

export interface ContractStats {
  transferCount: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  volumeByAsset: { asset: string; volume: string }[];
}

export interface Page<T> {
  data: T[];
  nextCursor: number | null;
}
