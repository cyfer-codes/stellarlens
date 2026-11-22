import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AuthModule } from "./auth/auth.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ContractsModule } from "./contracts/contracts.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { TransactionsModule } from "./transactions/transactions.module";
import { TransfersModule } from "./transfers/transfers.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ApiKeysModule,
    ContractsModule,
    EventsModule,
    TransfersModule,
    TransactionsModule,
    WebhooksModule
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter
    }
  ]
})
export class AppModule {}