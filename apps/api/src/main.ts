import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

type ApiKeyIdCandidate = string | number | string[] | undefined;

interface LoggedRequest {
  method: string;
  url: string;
  originalUrl?: string;
  apiKey?: { id?: number };
  apiKeyId?: ApiKeyIdCandidate;
  user?: { apiKeyId?: ApiKeyIdCandidate };
  auth?: { apiKeyId?: ApiKeyIdCandidate };
  headers?: Record<string, ApiKeyIdCandidate>;
}

interface LoggedResponse {
  statusCode: number;
  on(event: "finish", listener: () => void): void;
}

function getApiKeyId(req: LoggedRequest): string | number | null {
  const candidates = [
    req?.apiKey?.id,
    req?.apiKeyId,
    req?.user?.apiKeyId,
    req?.auth?.apiKeyId,
    req?.headers?.["x-api-key-id"],
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return candidate as string | number;
    }
  }
  return null;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({ origin: corsOrigins.length ? corsOrigins : false });
  app.use((req: LoggedRequest, res: LoggedResponse, next: () => void) => {
    const start = process.hrtime.bigint();
    const method = req.method;
    const path = req.originalUrl ?? req.url;

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const entry = {
        level: "info",
        type: "request",
        method,
        path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
        apiKeyId: getApiKeyId(req),
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(entry));
    });

    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("API")
      .setDescription("API documentation")
      .setVersion("1.0")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();