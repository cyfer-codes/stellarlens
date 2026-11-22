import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min, Validate } from "class-validator";
import { DateRangeOrderConstraint } from "../../common/validators/date-range.validator";

export const EVENT_ORDERS = ["asc", "desc"] as const;
export type EventOrder = (typeof EVENT_ORDERS)[number];

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

  /**
   * `asc` (default) pages oldest-first and `cursor` returns events with a larger id; `desc` pages
   * newest-first and `cursor` returns events with a smaller id. `order=desc&limit=1` gives the latest event.
   */
  @IsOptional()
  @IsIn(EVENT_ORDERS)
  order: EventOrder = "asc";

  /**
   * Matches the topic value at any position (containment semantics).
   * Use `topic0`..`topic3` to target a specific decoded topic index.
   */
  @ApiPropertyOptional({
    description: "Filter events by a single topic.",
    example: "transfer",
  })
  @IsOptional()
  @IsString()
  topic?: string;

  /**
   * Matches the decoded topic at index 0.
   */
  @IsOptional()
  @IsString()
  topic0?: string;

  /**
   * Matches the decoded topic at index 1.
   */
  @IsOptional()
  @IsString()
  topic1?: string;

  /**
   * Matches the decoded topic at index 2.
   */
  @IsOptional()
  @IsString()
  topic2?: string;

  /**
   * Matches the decoded topic at index 3.
   */
  @IsOptional()
  @IsString()
  topic3?: string;

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
  @Validate(DateRangeOrderConstraint)
  to?: string;
}