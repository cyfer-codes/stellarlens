import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";

export class FindEventsQueryDto {
  @ApiPropertyOptional({
    description: "Opaque pagination cursor returned by a previous request.",
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @ApiPropertyOptional({
    description: "Maximum number of events to return.",
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description: "Filter events by a single topic.",
    example: "transfer",
  })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({
    description:
      "Filter events by one or more topics. Accepts repeated query params or a comma-separated list.",
    type: [String],
    example: ["transfer", "mint"],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return value;
    }
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => (typeof item === "string" ? item.split(",") : [item]))
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "");
  })
  @IsString({ each: true })
  topics?: string[];

  @ApiPropertyOptional({
    description: "Only include events at or after this ISO 8601 timestamp.",
    format: "date-time",
    example: "2024-01-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: "Only include events at or before this ISO 8601 timestamp.",
    format: "date-time",
    example: "2024-12-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}