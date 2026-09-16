import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { tokenTransfers, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { FindTransfersQueryDto } from "./dto/find-transfers-query.dto";
import { StatsQueryDto } from "./dto/stats-query.dto";

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
}
