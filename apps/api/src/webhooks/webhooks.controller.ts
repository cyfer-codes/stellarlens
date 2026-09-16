import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from "@nestjs/common";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { WebhooksService } from "./webhooks.service";

@Controller("contracts/:contractId/webhooks")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  register(@Param("contractId", ParseIntPipe) contractId: number, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.register(contractId, dto);
  }

  @Get()
  findAll(@Param("contractId", ParseIntPipe) contractId: number) {
    return this.webhooksService.findAllByContract(contractId);
  }

  @Get(":id")
  findOne(
    @Param("contractId", ParseIntPipe) contractId: number,
    @Param("id", ParseIntPipe) id: number
  ) {
    return this.webhooksService.findOneByContract(contractId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("contractId", ParseIntPipe) contractId: number, @Param("id", ParseIntPipe) id: number) {
    return this.webhooksService.remove(contractId, id);
  }
}
