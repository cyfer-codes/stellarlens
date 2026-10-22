import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { CreateWebhookDto } from "./dto/create-webhook.dto";
import { FindDeliveriesQueryDto } from "./dto/find-deliveries-query.dto";
import { UpdateWebhookDto } from "./dto/update-webhook.dto";
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

  @Patch(":id")
  update(
    @Param("contractId", ParseIntPipe) contractId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateWebhookDto
  ) {
    return this.webhooksService.update(contractId, id, dto);
  }

  @Get(":id/deliveries")
  findDeliveries(
    @Param("contractId", ParseIntPipe) contractId: number,
    @Param("id", ParseIntPipe) id: number,
    @Query() query: FindDeliveriesQueryDto
  ) {
    return this.webhooksService.findDeliveries(contractId, id, query);
  }

  @Post(":id/rotate-secret")
  rotateSecret(@Param("contractId", ParseIntPipe) contractId: number, @Param("id", ParseIntPipe) id: number) {
    return this.webhooksService.rotateSecret(contractId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("contractId", ParseIntPipe) contractId: number, @Param("id", ParseIntPipe) id: number) {
    return this.webhooksService.remove(contractId, id);
  }
}