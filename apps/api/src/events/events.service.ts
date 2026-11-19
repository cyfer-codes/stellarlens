import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { events, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { FindEventsQueryDto } from "./dto/find-events-query.dto";

/**
 * Event filtering semantics:
 * - `topic` matches the value at ANY position in the decoded topics array
 *   (JSONB containment). Filtering transfers "to" an address therefore also
 *   matches transfers "from" it.
 * - `topic0`..`topic3` match the decoded topic at that exact index only.
 *   They combine (AND) with each other and with all other filters.
 */

@Injectable()
export class EventsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) {}

  async findByContract(contractId: number, query: FindEventsQueryDto) {
    await this.contractsService.findOne(contractId);

    const conditions = [eq(events.contractId, contractId)];

    if (query.cursor !== undefined) {
      conditions.push(gt(events.id, query.cursor));
    }
    if (query.from) {
      conditions.push(gte(events.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(events.createdAt, new Date(query.to)));
    }
    // `topic` uses JSONB containment, so it matches the given value at ANY
    // position in the decoded topics array (e.g. filtering transfers "to" an
    // address also matches transfers "from" it). Use `topic0`..`topic3` for
    // exact positional matching.
    if (query.topic) {
      conditions.push(
        sql`${events.decodedData} -> 'decoded' -> 'topic' @> ${JSON.stringify([query.topic])}::jsonb`
      );
    }
    const positionalTopics = [query.topic0, query.topic1, query.topic2, query.topic3];
    positionalTopics.forEach((value, index) => {
      if (value) {
        conditions.push(
          sql`${events.decodedData} -> 'decoded' -> 'topic' ->> ${sql.raw(String(index))} = ${value}`
        );
      }
    });
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
      .orderBy(asc(events.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }
}
