import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AuditLogInterceptor } from "./audit-log/audit-log.interceptor";
import { AuditLogModule } from "./audit-log/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ContractsModule } from "./contracts/contracts.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { IndexerController } from "./indexer.controller";
import { TransactionsModule } from "./transactions/transactions.module";
import { TransfersModule } from "./transfers/transfers.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ApiKeysModule,
    AuditLogModule,
    ContractsModule,
    EventsModule,
    TransfersModule,
    TransactionsModule,
    WebhooksModule
  ],
  controllers: [HealthController, IndexerController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor
    }
  ]
})
export class AppModule {}