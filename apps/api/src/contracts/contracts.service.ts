import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gt, ilike, inArray, max } from "drizzle-orm";
import { contracts, events, indexerCheckpoints, type Database } from "@stellarlens/db";
import { DATABASE } from "../database/database.module";
import {
  BulkCreateContractsDto,
  type BulkCreateContractItemDto
} from "./dto/bulk-create-contracts.dto";
import { CreateContractDto } from "./dto/create-contract.dto";
import { FindContractsQueryDto } from "./dto/find-contracts-query.dto";
import { isValidStellarAddress } from "./dto/is-stellar-address.decorator";
import { UpdateContractDto } from "./dto/update-contract.dto";

export type BulkContractStatus = "created" | "existing" | "error";

export interface BulkContractResult {
  index: number;
  address: string | null;
  network: string | null;
  name: string | null;
  status: BulkContractStatus;
  id?: number;
  error?: string;
}

export interface BulkContractResponse {
  results: BulkContractResult[];
}

type PreparedBulkItem =
  | { kind: "error"; result: BulkContractResult }
  | { kind: "valid"; address: string; network: string; name: string | null };

@Injectable()
export class ContractsService {
  constructor(@Inject(DATABASE) private readonly db: Database) { }

  async register(dto: CreateContractDto) {
    const [contract] = await this.db
      .insert(contracts)
      .values({ address: dto.address, name: dto.name ?? null, network: dto.network })
      .onConflictDoUpdate({
        target: contracts.address,
        set: { name: dto.name ?? null, network: dto.network }
      })
      .returning();
    return contract;
  }

  /**
   * Registers up to 100 contracts in a single transaction, reporting a result
   * per item instead of failing the whole batch when one entry is invalid.
   *
   * Items that are already registered are left untouched (status `existing`)
   * rather than updated, so a bulk onboarding import can't silently overwrite
   * an existing contract's name or network.
   */
  async registerBulk(dto: BulkCreateContractsDto): Promise<BulkContractResponse> {
    const prepared: PreparedBulkItem[] = dto.items.map((item: BulkCreateContractItemDto, index) => {
      const address = item.address.trim();
      const network = item.network.trim();
      const name = item.name ?? null;

      if (!isValidStellarAddress(address)) {
        return {
          kind: "error",
          result: {
            index,
            address: address || null,
            network: network || null,
            name,
            status: "error",
            error: "address must be a well-formed Stellar contract (C...) or account (G...) strkey"
          }
        };
      }

      if (network.length === 0) {
        return {
          kind: "error",
          result: {
            index,
            address,
            network: null,
            name,
            status: "error",
            error: "network must not be empty"
          }
        };
      }

      return { kind: "valid", address, network, name };
    });

    const pending = new Map<
      string,
      { address: string; network: string; name: string | null; indexes: number[] }
    >();
    for (const [index, item] of prepared.entries()) {
      if (item.kind !== "valid") {
        continue;
      }
      const entry = pending.get(item.address);
      if (entry) {
        entry.indexes.push(index);
      } else {
        pending.set(item.address, {
          address: item.address,
          network: item.network,
          name: item.name,
          indexes: [index]
        });
      }
    }

    const insertedByAddress = new Map<
      string,
      { id: number; name: string | null; network: string }
    >();
    const existingByAddress = new Map<
      string,
      { id: number; name: string | null; network: string }
    >();

    if (pending.size > 0) {
      const rows = [...pending.values()];
      const inserted = await this.db.transaction(async (tx) => {
        const created = await tx
          .insert(contracts)
          .values(rows.map(({ address, network, name }) => ({ address, network, name })))
          .onConflictDoNothing({ target: contracts.address })
          .returning();

        const createdAddresses = new Set(created.map((contract) => contract.address));
        const alreadyRegistered = rows
          .map(({ address }) => address)
          .filter((address) => !createdAddresses.has(address));

        const existing =
          alreadyRegistered.length > 0
            ? await tx.select().from(contracts).where(inArray(contracts.address, alreadyRegistered))
            : [];

        return { created, existing };
      });

      for (const contract of inserted.created) {
        insertedByAddress.set(contract.address, contract);
      }
      for (const contract of inserted.existing) {
        existingByAddress.set(contract.address, contract);
      }
    }

    const results = prepared.map((item, index): BulkContractResult => {
      if (item.kind === "error") {
        return item.result;
      }

      const stored = insertedByAddress.get(item.address) ?? existingByAddress.get(item.address);
      const created =
        insertedByAddress.has(item.address) && pending.get(item.address)?.indexes[0] === index;

      return {
        index,
        address: item.address,
        network: stored?.network ?? item.network,
        name: stored?.name ?? item.name,
        status: created ? "created" : "existing",
        ...(stored ? { id: stored.id } : {})
      };
    });

    return { results };
  }

  async findAll(query: FindContractsQueryDto = new FindContractsQueryDto()) {
    const conditions = [];

    if (query.cursor !== undefined) {
      conditions.push(gt(contracts.id, query.cursor));
    }
    if (query.name) {
      conditions.push(ilike(contracts.name, `%${query.name}%`));
    }
    if (query.network) {
      conditions.push(eq(contracts.network, query.network));
    }

    const rows = await this.db
      .select()
      .from(contracts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(contracts.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }

  async findOne(id: number) {
    const [contract] = await this.db.select().from(contracts).where(eq(contracts.id, id));
    if (!contract) {
      throw new NotFoundException(`contract ${id} not found`);
    }

    // Token metadata is cached on the contract row by the indexer (via a
    // read-only simulation of SEP-41 `decimals()`, `symbol()` and `name()`).
    // Non-token contracts have these columns null, so expose them as null.
    return {
      ...contract,
      decimals: contract.decimals ?? null,
      symbol: contract.symbol ?? null,
      name: contract.name ?? null
    };
  }

  async findStatus(id: number) {
    const contract = await this.findOne(id);
    const [checkpoint] = await this.db
      .select({ latestLedger: indexerCheckpoints.latestLedger, updatedAt: indexerCheckpoints.updatedAt })
      .from(indexerCheckpoints)
      .where(eq(indexerCheckpoints.network, contract.network));

    if (!checkpoint) {
      return { status: "not_indexed" as const, lag: null };
    }

    const [indexed] = await this.db
      .select({ ledger: max(events.ledger) })
      .from(events)
      .where(eq(events.contractId, id));
    const indexedLedger = indexed?.ledger ?? null;
    const lag = checkpoint.latestLedger !== null && indexedLedger !== null
      ? Math.max(0, checkpoint.latestLedger - indexedLedger)
      : 0;
    const stale = Date.now() - checkpoint.updatedAt.getTime() > 120_000;

    return {
      status: stale || lag > 0 ? "behind" as const : "live" as const,
      lag,
      latestLedger: checkpoint.latestLedger,
      indexedLedger,
      updatedAt: checkpoint.updatedAt.toISOString()
    };
  }

  async update(id: number, dto: UpdateContractDto) {
    const values: { name?: string | null; network?: string } = {};
    if (dto.name !== undefined) {
      values.name = dto.name;
    }
    if (dto.network !== undefined) {
      values.network = dto.network;
    }

    if (Object.keys(values).length === 0) {
      return this.findOne(id);
    }

    const [contract] = await this.db
      .update(contracts)
      .set(values)
      .where(eq(contracts.id, id))
      .returning();

    if (!contract) {
      throw new NotFoundException(`contract ${id} not found`);
    }

    return contract;
  }
}
