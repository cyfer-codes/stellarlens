import { Controller, Get, Query } from "@nestjs/common";
import { RequireScope } from "../auth/guards/require-scope.decorator";
import { AuditLogService } from "./audit-log.service";
import { FindAuditLogQueryDto } from "./dto/find-audit-log-query.dto";

@Controller("audit-log")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequireScope("full")
  findAll(@Query() query: FindAuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
