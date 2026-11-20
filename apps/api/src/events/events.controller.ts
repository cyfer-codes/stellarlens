import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Sse,
} from "@nestjs/common";
import { Request } from "express";
import { Observable } from "rxjs";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { EventsService } from "./events.service";
import { FindEventsQueryDto } from "./dto/find-events-query.dto";
import { FindRecentEventsQueryDto } from "./dto/find-recent-events-query.dto";

@Controller()
import { ContractEventDto } from "./dto/contract-event.dto";
import { PaginatedEventsDto } from "./dto/paginated-events.dto";
import { SseEventDto } from "./dto/sse-event.dto";

@ApiTags("events")
@ApiSecurity("x-api-key")
@Controller("contracts/:contractId/events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Get("events")
  findRecent(@Query() query: FindRecentEventsQueryDto) {
    return this.eventsService.findRecent(query.limit);
  }

  @Get("contracts/:contractId/events")
  findByContract(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: FindEventsQueryDto) {
  @Get()
  @ApiOperation({
    summary: "List events for a contract",
    description:
      "Returns a paginated list of events emitted by the given contract, ordered newest first.",
  })
  @ApiParam({ name: "contractId", description: "Contract identifier", type: Number })
  @ApiOkResponse({ description: "Paginated list of contract events", type: PaginatedEventsDto })
  findByContract(
    @Param("contractId", ParseIntPipe) contractId: number,
    @Query() query: FindEventsQueryDto,
  ) {
    return this.eventsService.findByContract(contractId, query);
  }

  @Sse("stream")
  @ApiOperation({
    summary: "Stream new events for a contract (SSE)",
    description:
      "Opens a server-sent events stream that pushes newly observed events for the given contract. " +
      "Clients may resume from a known event by sending the `Last-Event-ID` header (or the " +
      "`lastEventId` query parameter). Heartbeats are sent periodically to keep the connection alive.",
  })
  @ApiParam({ name: "contractId", description: "Contract identifier", type: Number })
  @ApiQuery({
    name: "lastEventId",
    required: false,
    description: "Resume the stream after this event id (alternative to the Last-Event-ID header)",
    type: String,
  })
  @ApiHeader({
    name: "Last-Event-ID",
    required: false,
    description: "Resume the stream after this event id",
  })
  @ApiProduces("text/event-stream")
  @ApiOkResponse({ description: "Server-sent event stream of contract events", type: SseEventDto })
  stream(
    @Param("contractId", ParseIntPipe) contractId: number,
    @Headers("last-event-id") lastEventIdHeader: string | undefined,
    @Query("lastEventId") lastEventIdQuery: string | undefined,
    @Req() req: Request,
  ): Observable<SseEventDto> {
    const lastEventId = lastEventIdHeader ?? lastEventIdQuery ?? undefined;
    const apiKeyId = (req as Request & { apiKeyId?: string }).apiKeyId;
    return this.eventsService.streamEvents(contractId, lastEventId, apiKeyId);
  }
}