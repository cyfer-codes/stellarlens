import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

const INTEGER_DECIMAL_STRING = /^-?\d+$/;

@ValidatorConstraint({ name: "minAmountNotGreaterThanMaxAmount", async: false })
class MinAmountNotGreaterThanMaxAmountConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as FindTransfersQueryDto;
    if (dto.minAmount === undefined || dto.maxAmount === undefined) {
      return true;
    }
    if (!INTEGER_DECIMAL_STRING.test(dto.minAmount) || !INTEGER_DECIMAL_STRING.test(dto.maxAmount)) {
      // Let the per-field @Matches validators report format errors.
      return true;
    }
    return BigInt(dto.minAmount) <= BigInt(dto.maxAmount);
  }

  defaultMessage(): string {
    return "minAmount must not be greater than maxAmount";
  }
}

export class FindTransfersQueryDto {
  @ApiPropertyOptional({
    description: "Pagination cursor (transfer id) to fetch results after",
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @ApiPropertyOptional({
    description: "Maximum number of transfers to return",
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      "Minimum transfer amount (inclusive) as an integer decimal string in base units",
    example: "100000000000000000000",
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(INTEGER_DECIMAL_STRING, {
    message: "minAmount must be an integer decimal string",
  })
  @Validate(MinAmountNotGreaterThanMaxAmountConstraint)
  minAmount?: string;

  @ApiPropertyOptional({
    description:
      "Maximum transfer amount (inclusive) as an integer decimal string in base units",
    example: "100000000000000000001",
    type: String,
  })
  @IsOptional()
  @IsString()
  @Matches(INTEGER_DECIMAL_STRING, {
    message: "maxAmount must be an integer decimal string",
  })
  @Validate(MinAmountNotGreaterThanMaxAmountConstraint)
  maxAmount?: string;

  @ApiPropertyOptional({
    description: "Filter transfers sent from this account",
    example: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({
    description: "Filter transfers sent to this account",
    example: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: "Filter transfers by asset code",
    example: "XLM",
  })
  @IsOptional()
  @IsString()
  asset?: string;
}

export type AccountTransfersDirection = "in" | "out" | "both";

export class AccountTransfersQueryDto {
  @IsOptional()
  @IsIn(["in", "out", "both"])
  direction: AccountTransfersDirection = "both";

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
  @IsIn(["asc", "desc"])
  order: "asc" | "desc" = "asc";
}