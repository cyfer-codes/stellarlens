import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";

export const EVENT_ORDERS = ["asc", "desc"] as const;
export type EventOrder = (typeof EVENT_ORDERS)[number];

export class FindEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

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

  @IsOptional()
  @IsString()
  topic?: string;

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

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
