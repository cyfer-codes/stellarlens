import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { webhookDeliveries, webhooks, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { FindDeliveriesQueryDto } from "./dto/find-deliveries-query.dto";
import { UpdateWebhookDto } from "./dto/update-webhook.dto";

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) {}

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
    const [webhook] = await this.db
      .insert(webhooks)
      .values({ contractId, url: dto.url, secret, eventTypes })
      .returning();
    return webhook;
  }

  async findAllByContract(contractId: number) {
    await this.contractsService.findOne(contractId);

    return this.db
      .select({ id: webhooks.id, url: webhooks.url, eventTypes: webhooks.eventTypes, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(eq(webhooks.contractId, contractId));
  }

  async update(contractId: number, id: number, dto: UpdateWebhookDto) {
    await this.contractsService.findOne(contractId);

    const updates: { url?: string; eventTypes?: string[] | null } = {};
    if (dto.url !== undefined) {
      updates.url = dto.url;
    }
    if (dto.eventTypes !== undefined) {
      updates.eventTypes = dto.eventTypes.length > 0 ? dto.eventTypes : null;
    }

    if (Object.keys(updates).length === 0) {
      const [webhook] = await this.db
        .select({
          id: webhooks.id,
          contractId: webhooks.contractId,
          url: webhooks.url,
          eventTypes: webhooks.eventTypes,
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

    return webhook;
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

    const rows = await this.db
      .select({
        id: webhookDeliveries.id,
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
}
