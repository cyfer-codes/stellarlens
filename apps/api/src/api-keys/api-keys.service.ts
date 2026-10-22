import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { apiKeys, type Database } from "@stellarlens/db";
import { DATABASE } from "../database/database.module";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async generate(dto: CreateApiKeyDto) {
    const rawKey = randomBytes(24).toString("hex");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const scope = dto.scope ?? "full";
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    const [apiKey] = await this.db
      .insert(apiKeys)
      .values({ keyHash, name: dto.name ?? null, scope, expiresAt })
      .returning({
        scope: apiKeys.scope,
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt
      });

    return { ...apiKey, key: rawKey };
  }

  findAll() {
    return this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        scope: apiKeys.scope,
        createdAt: apiKeys.createdAt,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));
  }

  async revoke(id: number): Promise<void> {
    const [existing] = await this.db
      .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(eq(apiKeys.id, id));

    if (!existing) {
      throw new NotFoundException(`api key ${id} not found`);
    }
    if (existing.revokedAt) {
      return;
    }

    await this.db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  }
}
