import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";

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

  @IsOptional()
  @IsIn(["asc", "desc"])
  order: "asc" | "desc" = "asc";
}