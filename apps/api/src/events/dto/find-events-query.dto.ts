import { Transform, Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";

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
   * Matches the topic value at any position (containment semantics).
   * Use `topic0`..`topic3` to target a specific decoded topic index.
   */
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