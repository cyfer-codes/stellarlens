import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { events, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { FindEventsQueryDto } from "./dto/find-events-query.dto";

@Injectable()
export class EventsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) {}

  async findByContract(contractId: number, query: FindEventsQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(events.contractId, contractId)];

    const descending = query.order === "desc";

    if (query.cursor !== undefined) {
      conditions.push(descending ? lt(events.id, query.cursor) : gt(events.id, query.cursor));
    }
    if (query.from) {
      conditions.push(gte(events.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(events.createdAt, new Date(query.to)));
    }
    if (query.topic) {
      conditions.push(
        sql`${events.decodedData} -> 'decoded' -> 'topic' @> ${JSON.stringify([query.topic])}::jsonb`
      );
    }
    if (query.topics && query.topics.length > 0) {
      conditions.push(
        sql`${events.decodedData} -> 'decoded' -> 'topic' ?| ${sql.raw(
          `ARRAY[${query.topics.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ")}]::text[]`
        )}`
      );
    }

    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(descending ? desc(events.id) : asc(events.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }
}
