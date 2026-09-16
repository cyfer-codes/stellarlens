import { Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";
import { IsBefore } from "../../common/validators/is-before.validator";

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
  @IsISO8601()
  @IsBefore("to")
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
