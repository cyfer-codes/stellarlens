import { Controller, Get, Query } from "@nestjs/common";
import { FindTransfersQueryDto } from "./dto/find-transfers-query.dto";
import { TransfersService } from "./transfers.service";

@Controller("transfers")
export class AccountTransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  findByAccount(@Query("address") address: string, @Query() query: FindTransfersQueryDto) {
    return this.transfersService.findByAccount(address, query);
  }
}