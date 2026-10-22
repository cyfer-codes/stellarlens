import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { ContractsService } from "./contracts.service";
import { CreateContractDto } from "./dto/create-contract.dto";
import { FindContractsQueryDto } from "./dto/find-contracts-query.dto";
import { UpdateContractDto } from "./dto/update-contract.dto";

@Controller("contracts")
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  register(@Body() dto: CreateContractDto) {
    return this.contractsService.register(dto);
  }

  @Get()
  findAll(@Query() query: FindContractsQueryDto) {
    return this.contractsService.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.contractsService.findOne(id);
  }

  @Patch(":id")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateContractDto) {
    return this.contractsService.update(id, dto);
  }
}
