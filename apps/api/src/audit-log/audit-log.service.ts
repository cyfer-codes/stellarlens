import { Inject, Injectable } from "@nestjs/common";
import { and, desc, lt } from "drizzle-orm";
import { auditLog, type Database } from "@stellarlens/db";
import { DATABASE } from "../database/database.module";
import { FindAuditLogQueryDto } from "./dto/find-audit-log-query.dto";

@Injectable()
export class AuditLogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll(query: FindAuditLogQueryDto = new FindAuditLogQueryDto()) {
    const conditions = [];
    if (query.cursor !== undefined) {
      conditions.push(lt(auditLog.id, query.cursor));
    }

    const rows = await this.db
      .select()
      .from(auditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor };
  }
}
