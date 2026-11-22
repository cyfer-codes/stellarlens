import { createHash } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, type ApiKeyScope, type Database } from "@stellarlens/db";
import { DATABASE } from "../../database/database.module";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { REQUIRED_SCOPE_KEY } from "./require-scope.decorator";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const LAST_USED_AT_THROTTLE_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const key = request.headers["x-api-key"];
    if (!key || Array.isArray(key)) {
      throw new UnauthorizedException("missing x-api-key header");
    }

    const keyHash = createHash("sha256").update(key).digest("hex");
    const [apiKey] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));

    if (!apiKey) {
      throw new UnauthorizedException("invalid api key");
    }

    this.touchLastUsedAt(apiKey.id, apiKey.lastUsedAt);
    // Expired keys are rejected here. Key rotation relies on this: the old key
    // gets an `expiresAt` set to the end of the overlap window, so it keeps
    // working until then and fails afterwards.
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("invalid api key");
    }

    const method = String(request.method ?? "").toUpperCase();
    if (apiKey.scope === "read" && MUTATING_METHODS.has(method)) {
      throw new ForbiddenException("read-only api key cannot perform mutating requests");
    }

    const requiredScope = this.reflector.getAllAndOverride<ApiKeyScope>(REQUIRED_SCOPE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (requiredScope === "full" && apiKey.scope !== "full") {
      throw new ForbiddenException(`api key requires the "${requiredScope}" scope`);
    }

    request.apiKey = apiKey;
    return true;
  }

  // Fire-and-forget and throttled: the row we just read already carries lastUsedAt, so we only
  // issue a write when it's stale, and never await it so auth latency is unaffected.
  private touchLastUsedAt(id: number, lastUsedAt: Date | null): void {
    const now = new Date();
    if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < LAST_USED_AT_THROTTLE_MS) {
      return;
    }

    this.db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, id))
      .then(
        () => undefined,
        (error: unknown) =>
          this.logger.warn(`failed to update last_used_at for api key ${id}: ${String(error)}`)
      );
  }
}
