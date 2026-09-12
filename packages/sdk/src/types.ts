export interface Contract {
  id: number;
  address: string;
  name: string | null;
  network: string;
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
