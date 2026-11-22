import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, count, desc, eq, gte, lt, lte, ne, sql } from "drizzle-orm";
import { webhookDeliveries, webhooks, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { FindDeliveriesQueryDto } from "./dto/find-deliveries-query.dto";
import { UpdateWebhookDto } from "./dto/update-webhook.dto";

@Injectable()
export class WebhooksService {
  private readonly secretKey: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService,
    private readonly configService: ConfigService
  ) {
    const key = this.configService.get<string>("WEBHOOK_SECRET_KEY");
    if (!key) {
      throw new Error("WEBHOOK_SECRET_KEY is not configured");
    }
    this.secretKey = key;
  }

  async register(contractId: number, dto: CreateWebhookDto) {
    await this.contractsService.findOne(contractId);

    const [existing] = await this.db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.contractId, contractId), eq(webhooks.url, dto.url)));
    if (existing) {
      throw new ConflictException(`webhook ${existing.id} is already registered for ${dto.url} on contract ${contractId}`);
    }

    const secret = randomBytes(32).toString("hex");
    const eventTypes = dto.eventTypes && dto.eventTypes.length > 0 ? dto.eventTypes : null;
    const filter = dto.filter ?? null;
    const [webhook] = await this.db
      .insert(webhooks)
      .values({ contractId, url: dto.url, secret, eventTypes, filter })
      .returning();
    // The raw secret is only ever surfaced once, at creation time.
    return { ...webhook, secret };
  }

  async findAllByContract(contractId: number) {
    await this.contractsService.findOne(contractId);

    return this.db
      .select({ id: webhooks.id, url: webhooks.url, eventTypes: webhooks.eventTypes, filter: webhooks.filter, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(eq(webhooks.contractId, contractId));
  }

  /** Same projection as `findAllByContract`: the secret is never returned after creation/rotation. */
  async findOne(contractId: number, id: number) {
    await this.contractsService.findOne(contractId);

    const [webhook] = await this.db
      .select({ id: webhooks.id, url: webhooks.url, eventTypes: webhooks.eventTypes, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)));

    if (!webhook) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }

    return webhook;
  }

  async update(contractId: number, id: number, dto: UpdateWebhookDto) {
    await this.contractsService.findOne(contractId);

    const updates: { url?: string; eventTypes?: string[] | null; filter?: typeof webhooks.$inferInsert.filter } = {};
    if (dto.url !== undefined) {
      updates.url = dto.url;
    }
    if (dto.eventTypes !== undefined) {
      updates.eventTypes = dto.eventTypes.length > 0 ? dto.eventTypes : null;
    }
    if (dto.filter !== undefined) {
      updates.filter = dto.filter;
    }

    if (Object.keys(updates).length === 0) {
      const [webhook] = await this.db
        .select({
          id: webhooks.id,
          contractId: webhooks.contractId,
          url: webhooks.url,
          eventTypes: webhooks.eventTypes,
          filter: webhooks.filter,
          createdAt: webhooks.createdAt
        })
        .from(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)));
      if (!webhook) {
        throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
      }
      return webhook;
    }

    if (dto.url !== undefined) {
      const [duplicate] = await this.db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(and(eq(webhooks.contractId, contractId), eq(webhooks.url, dto.url), ne(webhooks.id, id)));
      if (duplicate) {
        throw new ConflictException(`webhook ${duplicate.id} is already registered for ${dto.url} on contract ${contractId}`);
      }
    }

    const [webhook] = await this.db
      .update(webhooks)
      .set(updates)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)))
      .returning({
        id: webhooks.id,
        contractId: webhooks.contractId,
        url: webhooks.url,
        eventTypes: webhooks.eventTypes,
        filter: webhooks.filter,
        createdAt: webhooks.createdAt
      });

    if (!webhook) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }

    return webhook;
  }

  async rotateSecret(contractId: number, id: number) {
    await this.contractsService.findOne(contractId);

    const secret = randomBytes(32).toString("hex");
    const [webhook] = await this.db
      .update(webhooks)
      .set({ secret })
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)))
      .returning();

    if (!webhook) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }

    // The raw secret is only ever surfaced once, at rotation time.
    return { ...webhook, secret };
  }

  async remove(contractId: number, id: number) {
    await this.contractsService.findOne(contractId);

    const [deleted] = await this.db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)))
      .returning({ id: webhooks.id });

    if (!deleted) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }
  }

  async findDeliveries(contractId: number, id: number, query: FindDeliveriesQueryDto) {
    await this.contractsService.findOne(contractId);

    const [webhook] = await this.db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)));

    if (!webhook) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }

    const conditions = [eq(webhookDeliveries.webhookId, id)];

    if (query.cursor !== undefined) {
      conditions.push(lt(webhookDeliveries.id, query.cursor));
    }

    if (query.status !== undefined) {
      conditions.push(eq(webhookDeliveries.status, query.status));
    }

    if (query.from !== undefined) {
      conditions.push(gte(webhookDeliveries.createdAt, new Date(query.from)));
    }

    if (query.to !== undefined) {
      conditions.push(lte(webhookDeliveries.createdAt, new Date(query.to)));
    }

    const rows = await this.db
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        idempotencyKey: webhookDeliveries.idempotencyKey,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastError: webhookDeliveries.lastError,
        deliveredAt: webhookDeliveries.deliveredAt,
        createdAt: webhookDeliveries.createdAt
      })
      .from(webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(webhookDeliveries.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }

  async getStats(contractId: number, id: number, window?: string) {
    await this.contractsService.findOne(contractId);

    const [webhook] = await this.db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)));

    if (!webhook) {
      throw new NotFoundException(`webhook ${id} not found for contract ${contractId}`);
    }

    const since = this.parseWindow(window);

    const [aggregate] = await this.db
      .select({
        total: count(),
        success: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'delivered')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')`.mapWith(Number),
        lastSuccessAt: sql<Date | null>`max(${webhookDeliveries.deliveredAt}) filter (where ${webhookDeliveries.status} = 'delivered')`,
        lastFailureAt: sql<Date | null>`max(${webhookDeliveries.createdAt}) filter (where ${webhookDeliveries.status} = 'failed')`
      })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, id), gte(webhookDeliveries.createdAt, since)));

    const total = Number(aggregate?.total ?? 0);
    const success = Number(aggregate?.success ?? 0);
    const failed = Number(aggregate?.failed ?? 0);
    const successRate = total > 0 ? success / total : 0;

    const recent = await this.db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, id), gte(webhookDeliveries.createdAt, since)))
      .orderBy(desc(webhookDeliveries.id));

    let consecutiveFailures = 0;
    for (const row of recent) {
      if (row.status === "failed") {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }

    return {
      total,
      success,
      failed,
      successRate,
      lastSuccessAt: aggregate?.lastSuccessAt ?? null,
      lastFailureAt: aggregate?.lastFailureAt ?? null,
      consecutiveFailures
    };
  }

  private parseWindow(window?: string): Date {
    const value = window ?? "24h";
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      throw new BadRequestException(`invalid window ${value}, expected format like 24h`);
    }

    const amount = Number(match[1]);
    const unitMs: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Date(Date.now() - amount * unitMs[match[2]]);
  }
}
