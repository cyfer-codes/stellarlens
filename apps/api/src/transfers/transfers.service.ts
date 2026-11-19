import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { tokenTransfers, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { FindAccountTransfersQueryDto } from "./dto/find-account-transfers-query.dto";
import { FindTransfersQueryDto } from "./dto/find-transfers-query.dto";
import { StatsQueryDto } from "./dto/stats-query.dto";
import { TopAccountsQueryDto } from "./dto/top-accounts-query.dto";
import { VolumeQueryDto } from "./dto/volume-query.dto";

@Injectable()
export class TransfersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) {}

  async findByContract(contractId: number, query: FindTransfersQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(tokenTransfers.contractId, contractId)];
    if (query.cursor !== undefined) {
      conditions.push(gt(tokenTransfers.id, query.cursor));
    }
    if (query.minAmount !== undefined) {
      conditions.push(gte(tokenTransfers.amount, String(query.minAmount)));
    }
    if (query.maxAmount !== undefined) {
      conditions.push(lte(tokenTransfers.amount, String(query.maxAmount)));
    }
    if (query.from !== undefined) {
      conditions.push(eq(tokenTransfers.from, query.from));
    }
    if (query.to !== undefined) {
      conditions.push(eq(tokenTransfers.to, query.to));
    }
    if (query.asset !== undefined) {
      conditions.push(eq(tokenTransfers.asset, query.asset));
    }

    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(and(...conditions))
      .orderBy(asc(tokenTransfers.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }

  async findByAccount(address: string, query: FindTransfersQueryDto) {
    const conditions = [or(eq(tokenTransfers.from, address), eq(tokenTransfers.to, address))!];
    if (query.cursor !== undefined) conditions.push(gt(tokenTransfers.id, query.cursor));
    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(and(...conditions))
      .orderBy(asc(tokenTransfers.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
  async findByTxHash(hash: string) {
    return this.db
      .select()
      .from(tokenTransfers)
      .where(eq(tokenTransfers.txHash, hash))
      .orderBy(asc(tokenTransfers.id));
  }

  async getStats(contractId: number, query: StatsQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(tokenTransfers.contractId, contractId)];
    if (query.from) {
      conditions.push(gte(tokenTransfers.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(tokenTransfers.createdAt, new Date(query.to)));
    }
    const where = and(...conditions);

    const [summary] = await this.db
      .select({
        transferCount: sql<string>`count(*)`,
        uniqueSenders: sql<string>`count(distinct ${tokenTransfers.from})`,
        uniqueReceivers: sql<string>`count(distinct ${tokenTransfers.to})`
      })
      .from(tokenTransfers)
      .where(where);

    const volumeByAsset = await this.db
      .select({
        asset: tokenTransfers.asset,
        volume: sql<string>`sum(${tokenTransfers.amount})`
      })
      .from(tokenTransfers)
      .where(where)
      .groupBy(tokenTransfers.asset);

    return {
      transferCount: Number(summary?.transferCount ?? 0),
      uniqueSenders: Number(summary?.uniqueSenders ?? 0),
      uniqueReceivers: Number(summary?.uniqueReceivers ?? 0),
      volumeByAsset
    };
  }

  /**
   * Bucketed volume time-series for charts.
   *
   * Buckets are produced with `date_trunc(interval, created_at)`. Empty buckets
   * are omitted (not zero-filled): only buckets that contain at least one
   * transfer are returned. Callers that need a continuous series should
   * zero-fill client-side using the requested `from`/`to` range.
   */
  async getVolumeTimeSeries(contractId: number, query: VolumeQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(tokenTransfers.contractId, contractId)];
    if (query.from) {
      conditions.push(gte(tokenTransfers.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(tokenTransfers.createdAt, new Date(query.to)));
    }
    if (query.asset !== undefined) {
      conditions.push(eq(tokenTransfers.asset, query.asset));
    }

    const bucket = sql`date_trunc(${query.interval}, ${tokenTransfers.createdAt})`;

    const rows = await this.db
      .select({
        bucket: sql<string>`${bucket}`,
        volume: sql<string>`sum(${tokenTransfers.amount})`,
        count: sql<string>`count(*)`
      })
      .from(tokenTransfers)
      .where(and(...conditions))
      .groupBy(bucket)
      .orderBy(asc(bucket));

    return rows.map((row) => ({
      bucket: row.bucket,
      volume: row.volume,
      count: Number(row.count)
    }));
  }

  async getTopAccounts(contractId: number, query: TopAccountsQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(tokenTransfers.contractId, contractId)];
    if (query.from) {
      conditions.push(gte(tokenTransfers.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(tokenTransfers.createdAt, new Date(query.to)));
    }

    const accountColumn =
      query.direction === "from" ? tokenTransfers.from : tokenTransfers.to;
    const volume = sql<string>`sum(${tokenTransfers.amount})`;

    const rows = await this.db
      .select({
        account: accountColumn,
        volume,
        count: sql<string>`count(*)`
      })
      .from(tokenTransfers)
      .where(and(...conditions))
      .groupBy(accountColumn)
      .orderBy(sql`${volume} desc`)
      .limit(query.limit);

    return rows.map((row) => ({
      account: row.account,
      volume: row.volume,
      count: Number(row.count)
    }));
  }

  async findForAccount(address: string, query: FindAccountTransfersQueryDto) {
    if (!isValidStellarAddress(address)) {
      throw new BadRequestException("Invalid Stellar address");
    }

    const conditions = [];
    if (query.direction === "out") {
      conditions.push(eq(tokenTransfers.from, address));
    } else if (query.direction === "in") {
      conditions.push(eq(tokenTransfers.to, address));
    } else {
      conditions.push(
        sql`(${tokenTransfers.from} = ${address} or ${tokenTransfers.to} = ${address})`
      );
    }
    if (query.cursor !== undefined) {
      conditions.push(gt(tokenTransfers.id, query.cursor));
    }

    const rows = await this.db
      .select()
      .from(tokenTransfers)
      .where(and(...conditions))
      .orderBy(asc(tokenTransfers.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }
}

const STRKEY_ED25519_PUBLIC_KEY = "G";
const STRKEY_CONTRACT = "C";
const STRKEY_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Validates a Stellar strkey address: an account (`G...`) or contract (`C...`)
 * public key, 56 characters of base32 with a valid version byte.
 */
function isValidStellarAddress(address: string): boolean {
  if (typeof address !== "string" || address.length !== 56) {
    return false;
  }
  const version = address[0];
  if (version !== STRKEY_ED25519_PUBLIC_KEY && version !== STRKEY_CONTRACT) {
    return false;
  }
  for (let i = 1; i < address.length; i += 1) {
    if (!STRKEY_BASE32_ALPHABET.includes(address[i])) {
      return false;
    }
  }
  return true;
}
