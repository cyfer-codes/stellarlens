import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys, type Database } from "@stellarlens/db";
import { DATABASE } from "../database/database.module";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";

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
        expiresAt: apiKeys.expiresAt
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
        revokedAt: apiKeys.revokedAt
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));
  }

  async update(id: number, dto: UpdateApiKeyDto) {
    const [existing] = await this.db
      .select({
        id: apiKeys.id,
        scope: apiKeys.scope,
        revokedAt: apiKeys.revokedAt
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, id));

    if (!existing) {
      throw new NotFoundException(`api key ${id} not found`);
    }
    if (existing.revokedAt) {
      throw new ConflictException(`api key ${id} has been revoked`);
    }

    let expiresAt: Date | null | undefined;
    if (dto.expiresAt !== undefined) {
      if (dto.expiresAt === null) {
        expiresAt = null;
      } else {
        const parsed = new Date(dto.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException("expiresAt must be a valid date");
        }
        if (parsed.getTime() <= Date.now()) {
          throw new BadRequestException("expiresAt cannot be in the past");
        }
        expiresAt = parsed;
      }
    }

    if (dto.scope !== undefined && dto.scope !== "full" && existing.scope === "full") {
      const remainingFullScope = await this.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(
          and(eq(apiKeys.scope, "full"), isNull(apiKeys.revokedAt), eq(apiKeys.id, id))
        );

      const others = await this.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.scope, "full"), isNull(apiKeys.revokedAt)));

      const otherFullScopeCount = others.filter((key) => key.id !== id).length;
      if (otherFullScopeCount === 0 && remainingFullScope.length > 0) {
        throw new ConflictException("cannot downgrade the last full-scope api key");
      }
    }

    const [updated] = await this.db
      .update(apiKeys)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {})
      })
      .where(eq(apiKeys.id, id))
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        scope: apiKeys.scope,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt
      });

    return updated;
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
