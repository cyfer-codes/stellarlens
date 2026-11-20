import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export enum DeliveryStatus {
  PENDING = "pending",
  DELIVERED = "delivered",
  FAILED = "failed",
}

export class FindDeliveriesQueryDto {
  @ApiPropertyOptional({
    description: "Pagination cursor (ID of the last delivery from the previous page)",
    type: Number,
    minimum: 1,
    example: 42,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @ApiPropertyOptional({
    description: "Maximum number of deliveries to return",
    type: Number,
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
    description: "Filter deliveries by status",
    enum: DeliveryStatus,
    example: DeliveryStatus.FAILED,
  })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional({
    description: "Only include deliveries created at or after this ISO 8601 timestamp",
    type: String,
    format: "date-time",
    example: "2024-01-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: "Only include deliveries created at or before this ISO 8601 timestamp",
    type: String,
    format: "date-time",
    example: "2024-01-31T23:59:59.999Z",
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}