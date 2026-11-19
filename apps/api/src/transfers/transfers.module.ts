import { Module } from "@nestjs/common";
import { ContractsModule } from "../contracts/contracts.module";
import { AccountsTransfersController } from "./accounts-transfers.controller";
import { TransfersController } from "./transfers.controller";
import { AccountTransfersController } from "./account-transfers.controller";
import { TransfersService } from "./transfers.service";

@Module({
  imports: [ContractsModule],
  controllers: [TransfersController, AccountTransfersController],
  controllers: [TransfersController, AccountsTransfersController],
  providers: [TransfersService]
})
export class TransfersModule {}