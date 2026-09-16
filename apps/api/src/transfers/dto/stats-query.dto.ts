import { IsISO8601, IsOptional } from "class-validator";
import { IsBefore } from "../../common/validators/is-before.validator";

export class StatsQueryDto {
  @IsOptional()
  @IsISO8601()
  @IsBefore("to")
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
