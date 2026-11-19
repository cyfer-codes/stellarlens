import { Controller, Get, Param, ParseIntPipe, Query } from "@nestjs/common";
import { EventsService } from "./events.service";
import { FindEventsQueryDto } from "./dto/find-events-query.dto";
import { FindRecentEventsQueryDto } from "./dto/find-recent-events-query.dto";

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Get("events")
  findRecent(@Query() query: FindRecentEventsQueryDto) {
    return this.eventsService.findRecent(query.limit);
  }

  @Get("contracts/:contractId/events")
  findByContract(@Param("contractId", ParseIntPipe) contractId: number, @Query() query: FindEventsQueryDto) {
    return this.eventsService.findByContract(contractId, query);
  }
}
