import { Module } from "@nestjs/common";
import { ContractsModule } from "../contracts/contracts.module";
import { AccountTransfersController } from "./account-transfers.controller";
import { AccountsController, TransfersController } from "./transfers.controller";
import { TransfersService } from "./transfers.service";

@Module({
  imports: [ContractsModule],
  controllers: [TransfersController, AccountTransfersController, AccountsController],
  providers: [TransfersService]
})
export class TransfersModule {}
