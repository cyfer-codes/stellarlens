import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import { AccountTransfersQueryDto, FindTransfersQueryDto } from "./dto/find-transfers-query.dto";
import { StatsQueryDto, TopAccountsQueryDto, VolumeQueryDto } from "./dto/stats-query.dto";
import { TransfersService } from "./transfers.service";

@Controller("contracts/:contractId")
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get("transfers")
  findByContract(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: FindTransfersQueryDto) {
    return this.transfersService.findByContract(contractId, query);
  }

  @Get("stats")
  getStats(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: StatsQueryDto) {
    return this.transfersService.getStats(contractId, query);
  }

  @Get("stats/volume")
  getVolume(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: VolumeQueryDto) {
    return this.transfersService.getVolumeTimeSeries(contractId, query);
  }

  @Get("stats/top-accounts")
  getTopAccounts(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: TopAccountsQueryDto) {
    return this.transfersService.getTopAccounts(contractId, query);
  }
}

@Controller("accounts")
export class AccountsController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get(":address/transfers")
  findByAccount(@Param("address") address: string, @Query() query: AccountTransfersQueryDto) {
    return this.transfersService.findForAccount(address, query);
  }
}
