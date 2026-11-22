import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ContractsModule } from "../contracts/contracts.module";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [ContractsModule, ConfigModule],
  controllers: [WebhooksController],
  providers: [WebhooksService]
})
export class WebhooksModule {}
