import { createHash } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenElception,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, type Database } from "@stellarlens/db";
import { DATABASE } from "../../database/database.module";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

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

    const method = String(request.method ?? "").toUpperCase();
    if (apiKey.scope === "read" && MUTATING_METHODS.has(method)) {
      throw new ForbiddenException("read-only api key cannot perform mutating requests");
    }

    request.apiKey = apiKey;
    return true;
  }
}
