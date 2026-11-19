import { Module } from "@nestjs/common";
import { ContractsModule } from "../contracts/contracts.module";
import { TransfersController } from "./transfers.controller";
import { AccountTransfersController } from "./account-transfers.controller";
import { TransfersService } from "./transfers.service";

@Module({
  imports: [ContractsModule],
  controllers: [TransfersController, AccountTransfersController],
  providers: [TransfersService]
})
export class TransfersModule {}
