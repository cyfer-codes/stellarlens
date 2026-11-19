import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { contracts, events, type Database } from "@stellarlens/db";
import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { Observable, Subscription, interval, merge, of } from "rxjs";
import { concatMap, map, takeUntil } from "rxjs/operators";
import { Subject } from "rxjs";
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
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
const DEFAULT_MAX_STREAMS_PER_KEY = 5;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class EventsService {
  private readonly activeStreams = new Map<number, number>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) { }

  private get maxStreamsPerKey(): number {
    return parsePositiveInt(
      process.env.EVENTS_STREAM_MAX_PER_KEY,
      DEFAULT_MAX_STREAMS_PER_KEY
    );
  }

  private get pollIntervalMs(): number {
    return parsePositiveInt(
      process.env.EVENTS_STREAM_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS
    );
  }

  private get heartbeatIntervalMs(): number {
    return parsePositiveInt(
      process.env.EVENTS_STREAM_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_INTERVAL_MS
    );
  }

  private acquireStreamSlot(apiKeyId: number): void {
    const current = this.activeStreams.get(apiKeyId) ?? 0;
    if (current >= this.maxStreamsPerKey) {
      throw new Error(
        `Too many concurrent event streams for this API key (limit ${this.maxStreamsPerKey})`
      );
    }
    this.activeStreams.set(apiKeyId, current + 1);
  }

  private releaseStreamSlot(apiKeyId: number): void {
    const current = this.activeStreams.get(apiKeyId) ?? 0;
    if (current <= 1) {
      this.activeStreams.delete(apiKeyId);
    } else {
      this.activeStreams.set(apiKeyId, current - 1);
    }
  }

  async streamEvents(
    contractId: number,
    lastEventId: number | undefined,
    apiKeyId: number
  ): Promise<Observable<MessageEvent>> {
    await this.contractsService.findOne(contractId);

    this.acquireStreamSlot(apiKeyId);

    return new Observable<MessageEvent>((subscriber) => {
      let cursor = lastEventId ?? 0;
      let polling = false;
      let closed = false;

      const stop$ = new Subject<void>();

      const poll = async () => {
        if (polling || closed) return;
        polling = true;
        try {
          const rows = await this.db
            .select()
            .from(events)
            .where(and(eq(events.contractId, contractId), gt(events.id, cursor)))
            .orderBy(asc(events.id));

          for (const row of rows) {
            if (closed) break;
            cursor = row.id;
            subscriber.next({
              id: String(row.id),
              data: JSON.stringify(row),
            } as MessageEvent);
          }
        } catch (err) {
          if (!closed) {
            subscriber.error(err);
          }
        } finally {
          polling = false;
        }
      };

      const pollSub: Subscription = interval(this.pollIntervalMs)
        .pipe(takeUntil(stop$))
        .subscribe(() => {
          void poll();
        });

      const heartbeatSub: Subscription = interval(this.heartbeatIntervalMs)
        .pipe(takeUntil(stop$))
        .subscribe(() => {
          if (!closed) {
            subscriber.next({ data: "", type: "heartbeat" } as MessageEvent);
          }
        });

      // Kick off an initial poll so resuming clients get missed events promptly.
      void poll();

      return () => {
        closed = true;
        stop$.next();
        stop$.complete();
        pollSub.unsubscribe();
        heartbeatSub.unsubscribe();
        this.releaseStreamSlot(apiKeyId);
      };
    });
  }

  async findByContract(contractId: number, query: FindEventsQueryDto) {
    await this.contractsService.findOne(contractId);

    const direction = query.order === "desc" ? "desc" : "asc";
    const conditions = [eq(events.contractId, contractId)];

    if (query.cursor !== undefined) {
      conditions.push(
        direction === "desc"
          ? lt(events.id, query.cursor)
          : gt(events.id, query.cursor)
      );
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
      .orderBy(direction === "desc" ? desc(events.id) : asc(events.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }

  async findRecent(limit: number) {
    return this.db
      .select({
        id: events.id,
        contractId: events.contractId,
        contractName: contracts.name,
        ledger: events.ledger,
        txHash: events.txHash,
        topic: events.topic,
        decodedData: events.decodedData,
        createdAt: events.createdAt
      })
      .from(events)
      .innerJoin(contracts, eq(events.contractId, contracts.id))
      .orderBy(desc(events.ledger), desc(events.id))
      .limit(limit);
  async findByTxHash(hash: string) {
    return this.db
      .select()
      .from(events)
      .where(eq(events.txHash, hash))
      .orderBy(asc(events.id));
  }
}
