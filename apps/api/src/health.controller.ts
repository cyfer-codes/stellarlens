import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Database } from "@stellarlens/db";
import { Public } from "./auth/decorators/public.decorator";
import { DATABASE } from "./database/database.module";

@Controller("health")
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Public()
  @Get()
  check() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException({ status: "error" });
    }
  }
}