import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { STATUS_CODES } from "node:http";

/** The single error envelope returned by every API endpoint. */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  requestId?: string;
}

interface HttpRequest {
  requestId?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

const REQUEST_ID_HEADER = "x-request-id";

function readRequestId(request: HttpRequest | undefined): string | undefined {
  if (!request) return undefined;
  if (typeof request.requestId === "string" && request.requestId.length > 0) {
    return request.requestId;
  }
  const header = request.headers?.[REQUEST_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function statusText(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? "Error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMessage(value: unknown, fallback: string): string | string[] {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return fallback;
}

/**
 * Converts every thrown value into the API's stable error envelope.
 *
 * - `HttpException`s keep their status code and any `message`/`error` fields
 *   from their response payload.
 * - Unexpected errors become a generic 500 response so internal details never
 *   leak to clients.
 */
export function normalizeException(exception: unknown, requestId?: string): ApiErrorResponse {
  const envelope = buildEnvelope(exception);
  return requestId ? { ...envelope, requestId } : envelope;
}

function buildEnvelope(exception: unknown): ApiErrorResponse {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const fallback = statusText(statusCode);
    const payload = exception.getResponse();

    if (typeof payload === "string") {
      return {
        statusCode,
        message: normalizeMessage(payload, exception.message),
        error: fallback
      };
    }

    if (isRecord(payload)) {
      const error =
        typeof payload.error === "string" && payload.error.length > 0 ? payload.error : fallback;
      return {
        statusCode,
        message: normalizeMessage(payload.message, exception.message),
        error
      };
    }

    return {
      statusCode,
      message: normalizeMessage(exception.message, fallback),
      error: fallback
    };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    error: "Internal Server Error"
  };
}

/**
 * Global exception filter that normalizes every error response to
 * `{ statusCode, message, error }`, regardless of which NestJS exception was
 * thrown or whether the error was unexpected.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const requestId = readRequestId(request);
    const normalized = normalizeException(exception, requestId);

    if (normalized.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail =
        exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
      const prefix = requestId ? `[requestId=${requestId}] ` : "";
      this.logger.error(`${prefix}${detail}`);
    }

    response.status(normalized.statusCode).json(normalized);
  }
}
