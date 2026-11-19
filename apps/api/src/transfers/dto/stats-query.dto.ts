import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional } from "class-validator";

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: "Start of the date range (inclusive) in ISO 8601 format.",
    example: "2024-01-01T00:00:00.000Z",
    format: "date-time",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: "End of the date range (inclusive) in ISO 8601 format.",
    example: "2024-12-31T23:59:59.999Z",
    format: "date-time",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}