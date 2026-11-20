import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import { AccountTransfersQueryDto } from "./dto/account-transfers-query.dto";
import { FindTransfersQueryDto } from "./dto/find-transfers-query.dto";
import { StatsQueryDto } from "./dto/stats-query.dto";
import { TopAccountsQueryDto } from "./dto/top-accounts-query.dto";
import { VolumeQueryDto } from "./dto/volume-query.dto";
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
    return this.transfersService.getVolume(contractId, query);
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