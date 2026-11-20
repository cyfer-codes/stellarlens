import { ApiProperty } from "@nestjs/swagger";

export class PaginatedEventsDto {
  @ApiProperty({ type: [Object] })
  data: unknown[];

  @ApiProperty({ nullable: true, example: 42 })
  nextCursor: number | null;
}
