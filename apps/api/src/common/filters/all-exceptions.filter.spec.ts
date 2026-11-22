import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  Logger,
  Module,
  NotFoundException
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "./all-exceptions.filter";

@Controller("errors")
class ErrorsController {
  @Get("known")
  known(): never {
    throw new NotFoundException("missing");
  }

  @Get("validation")
  validation(): never {
    throw new BadRequestException({
      message: ["name must be a string", "amount must be positive"],
      error: "Bad Request"
    });
  }

  @Get("unexpected")
  unexpected(): never {
    throw new Error("boom: database password leaked");
  }
}

@Module({
  controllers: [ErrorsController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }]
})
class ErrorsModule {}

describe("AllExceptionsFilter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      imports: [ErrorsModule]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it("preserves the status code and message of a known HttpException", async () => {
    const response = await request(app.getHttpServer())
      .get("/errors/known")
      .set("X-Request-Id", "req-known-123")
      .expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      message: "missing",
      error: "Not Found",
      requestId: "req-known-123"
    });
    expect(response.headers["x-request-id"]).toBe("req-known-123");
  });

  it("preserves array validation messages from an HttpException", async () => {
    const response = await request(app.getHttpServer())
      .get("/errors/validation")
      .set("X-Request-Id", "req-validation-456")
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      message: ["name must be a string", "amount must be positive"],
      error: "Bad Request",
      requestId: "req-validation-456"
    });
    expect(response.headers["x-request-id"]).toBe("req-validation-456");
  });

  it("generates a request id when none is provided", async () => {
    const response = await request(app.getHttpServer()).get("/errors/known").expect(404);

    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
  });

  it("normalizes unexpected errors to a generic 500 without leaking details", async () => {
    const response = await request(app.getHttpServer())
      .get("/errors/unexpected")
      .set("X-Request-Id", "req-unexpected-789")
      .expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
      error: "Internal Server Error",
      requestId: "req-unexpected-789"
    });
    expect(response.headers["x-request-id"]).toBe("req-unexpected-789");
    expect(JSON.stringify(response.body)).not.toContain("boom");
  });

  it("includes the request id in the logged 500 stack trace", async () => {
    const errorSpy = vi.spyOn(Logger.prototype, "error");

    await request(app.getHttpServer())
      .get("/errors/unexpected")
      .set("X-Request-Id", "req-logged-abc")
      .expect(500);

    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls
      .map((call) => call.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
      .join("\n");
    expect(logged).toContain("req-logged-abc");
  });
});
