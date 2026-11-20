import { ApiProperty } from "@nestjs/swagger";

export class SseEventDto {
  @ApiProperty({ example: "event" })
  type: string;

  @ApiProperty({ type: Object })
  data: unknown;
}
