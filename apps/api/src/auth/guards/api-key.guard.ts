import { createHash } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
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

@Injectable()
export class ApiKeyGuard implements CanActivate {
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

    // Fire-and-forget throttled update for lastUsedAt (at most once every 60 seconds)
    // to prevent request latency and avoid database write amplification.
    const now = Date.now();
    if (!apiKey.lastUsedAt || now - apiKey.lastUsedAt.getTime() > 60_000) {
      this.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(apiKeys.id, apiKey.id))
        .catch(() => {
          // Fire-and-forget: do not block or fail the authenticated request if background write fails
        });
    }

    return true;
  }
}
