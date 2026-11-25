import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { auditLog, type Database } from "@stellarlens/db";
import { Observable, mergeMap } from "rxjs";
import { DATABASE } from "../database/database.module";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const COLLECTIONS = new Set(["contracts", "webhooks", "api-keys"]);

const RESOURCE_NAMES: Record<string, string> = {
  contracts: "contract",
  webhooks: "webhook",
  "api-keys": "api-key"
};

const METHOD_ACTIONS: Record<string, string> = {
  POST: "create",
  PATCH: "update",
  PUT: "update",
  DELETE: "delete"
};

const SENSITIVE_KEY = /secret|password|token|authorization|api[-_]?key|^key$/i;

interface AuditRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  apiKey?: { id?: number };
}

function pathSegments(url: string): string[] {
  return url
    .split("?")[0]
    .split("/")
    .filter((segment) => segment.length > 0 && !/^\d+$/.test(segment));
}

function describeMutation(method: string, url: string): { action: string; resource: string } {
  const segments = pathSegments(url);
  let resource = "unknown";
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (COLLECTIONS.has(segment)) {
      resource = RESOURCE_NAMES[segment];
      break;
    }
  }

  const last = segments[segments.length - 1];
  const action = last && !COLLECTIONS.has(last) ? last : (METHOD_ACTIONS[method] ?? method.toLowerCase());
  return { action, resource };
}

function readResourceId(params: Record<string, unknown> | undefined, responseBody: unknown): string | null {
  const fromParams = params?.id;
  if (typeof fromParams === "string" && fromParams.length > 0) {
    return fromParams;
  }
  if (typeof fromParams === "number" && Number.isFinite(fromParams)) {
    return String(fromParams);
  }

  if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
    const id = (responseBody as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
    if (typeof id === "number" && Number.isFinite(id)) {
      return String(id);
    }
  }

  return null;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(nested);
  }
  return redacted;
}

function diffFromBody(body: unknown): Record<string, unknown> | unknown[] | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  if (Array.isArray(body)) {
    return body.length > 0 ? (redact(body) as unknown[]) : null;
  }
  if (Object.keys(body).length === 0) {
    return null;
  }
  return redact(body) as Record<string, unknown>;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditRequest>();
    const method = String(request.method ?? "").toUpperCase();
    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (responseBody) => {
        await this.record(request, method, responseBody);
        return responseBody;
      })
    );
  }

  private async record(request: AuditRequest, method: string, responseBody: unknown): Promise<void> {
    const url = request.originalUrl ?? request.url ?? "";
    const { action, resource } = describeMutation(method, url);
    const apiKeyId = typeof request.apiKey?.id === "number" ? request.apiKey.id : null;

    await this.db.insert(auditLog).values({
      apiKeyId,
      action,
      resource,
      resourceId: readResourceId(request.params, responseBody),
      diff: diffFromBody(request.body)
    });
  }
}
