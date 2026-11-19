import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import type { Database } from "@stellarlens/db";
import { Public } from "./auth/decorators/public.decorator";
import { DATABASE } from "./database/database.module";

const DEFAULT_INDEXER_STALE_AFTER_SECONDS = 60;

interface IndexerCheckpointRow {
  checkpoint: string | number | null;
  updated_at: string | Date | null;
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness probe" })
  @ApiOkResponse({
    description: "Service is alive.",
    schema: {
      type: "object",
      properties: { status: { type: "string", example: "ok" } },
    },
  })
  check() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  @ApiOperation({
    summary: "Readiness probe",
    description:
      "Verifies database connectivity and indexer freshness. Returns 'degraded' when the indexer checkpoint is older than INDEXER_STALE_AFTER_SECONDS.",
  })
  @ApiOkResponse({
    description: "Service is ready (or degraded when configured to return 200).",
    schema: {
      type: "object",
      properties: {
        status: { type: "string", example: "ok" },
        indexer: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            lastCheckpointAt: {
              type: "string",
              nullable: true,
              example: "2024-01-01T00:00:00.000Z",
            },
            lagSeconds: { type: "number", nullable: true, example: 12 },
            threshold: { type: "number", example: 60 },
          },
        },
      },
    },
  })
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: "error" });
    }

    const threshold = this.getStaleThresholdSeconds();
    const degradedReturns503 = this.getDegradedReturns503();

    let lastCheckpointAt: Date | null = null;
    try {
      const result = await this.db.execute<IndexerCheckpointRow>(
        sql`select checkpoint, updated_at from indexer_checkpoints order by updated_at desc limit 1`,
      );
      const rows = (result as unknown as { rows?: IndexerCheckpointRow[] })
        .rows ?? (result as unknown as IndexerCheckpointRow[]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (row?.updated_at) {
        lastCheckpointAt =
          row.updated_at instanceof Date
            ? row.updated_at
            : new Date(row.updated_at);
      }
    } catch {
      // If the checkpoint table is unavailable, treat the indexer as stale
      // rather than reporting ready with no freshness information.
      lastCheckpointAt = null;
    }

    const now = Date.now();
    const lagSeconds = lastCheckpointAt
      ? Math.max(0, Math.floor((now - lastCheckpointAt.getTime()) / 1000))
      : null;

    const isStale = lagSeconds === null || lagSeconds > threshold;

    const indexer = {
      status: isStale ? "degraded" : "ok",
      lastCheckpointAt: lastCheckpointAt
        ? lastCheckpointAt.toISOString()
        : null,
      lagSeconds,
      threshold,
    };

    if (isStale) {
      const body = { status: "degraded", indexer };
      if (degradedReturns503) {
        throw new ServiceUnavailableException(body);
      }
      return body;
    }

    return { status: "ok", indexer };
  }

  private getStaleThresholdSeconds(): number {
    const raw = this.config?.get<string>("INDEXER_STALE_AFTER_SECONDS");
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_INDEXER_STALE_AFTER_SECONDS;
  }

  private getDegradedReturns503(): boolean {
    const raw =
      this.config?.get<string>("INDEXER_DEGRADED_RETURNS_503") ??
      this.config?.get<string>("HEALTH_DEGRADED_STATUS");
    if (raw === undefined || raw === null) {
      return true;
    }
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === "503" || normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "200" || normalized === "false" || normalized === "0") {
      return false;
    }
    return true;
  }
}