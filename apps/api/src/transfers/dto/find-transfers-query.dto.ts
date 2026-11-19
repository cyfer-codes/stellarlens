import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

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
    description: "Minimum transfer amount (inclusive)",
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minAmount?: number;

  @ApiPropertyOptional({
    description: "Maximum transfer amount (inclusive)",
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxAmount?: number;

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