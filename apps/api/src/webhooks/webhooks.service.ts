import { randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { webhooks, type Database } from "@stellarlens/db";
import { ContractsService } from "../contracts/contracts.service";
import { DATABASE } from "../database/database.module";
import { CreateWebhookDto } from "./dto/create-webhook.dto";

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly contractsService: ContractsService
  ) {}

  async register(contractId: number, dto: CreateWebhookDto) {
    await this.contractsService.findOne(contractId);

    const secret = randomBytes(32).toString("hex");
    const [webhook] = await this.db
      .insert(webhooks)
      .values({ contractId, url: dto.url, secret })
      .returning();
    return webhook;
  }

  async findAllByContract(contractId: number) {
    await this.contractsService.findOne(contractId);

    return this.db
      .select({ id: webhooks.id, url: webhooks.url, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(eq(webhooks.contractId, contractId));
  }

  async findOneByContract(contractId: number, id: number) {
    await this.contractsService.findOne(contractId);

    const [webhook] = await this.db
      .select({ id: webhooks.id, url: webhooks.url, createdAt: webhooks.createdAt })
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.contractId, contractId)));

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
}
