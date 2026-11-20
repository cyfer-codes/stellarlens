import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AuthModule } from "./auth/auth.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ContractsModule } from "./contracts/contracts.module";
import { DatabaseModule } from "./database/database.module";
import { EventsModule } from "./events/events.module";
import { HealthController } from "./health.controller";
import { TransfersModule } from "./transfers/transfers.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    ApiKeysModule,
    ContractsModule,
    EventsModule,
    TransfersModule,
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
