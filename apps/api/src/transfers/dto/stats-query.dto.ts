import { Type } from "class-transformer";
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: "Start of the date range (inclusive) in ISO 8601 format.",
    example: "2024-01-01T00:00:00.000Z",
    format: "date-time",
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: "End of the date range (inclusive) in ISO 8601 format.",
    example: "2024-12-31T23:59:59.999Z",
    format: "date-time",
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export enum VolumeInterval {
  Hour = "hour",
  Day = "day",
}

export enum TopAccountsDirection {
  From = "from",
  To = "to",
}

export const MAX_VOLUME_BUCKETS = 1000;

const INTERVAL_MS: Record<VolumeInterval, number> = {
  [VolumeInterval.Hour]: 60 * 60 * 1000,
  [VolumeInterval.Day]: 24 * 60 * 60 * 1000,
};

@ValidatorConstraint({ name: "maxVolumeBuckets", async: false })
export class MaxVolumeBucketsConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as VolumeQueryDto;
    if (!dto.from || !dto.to) {
      return true;
    }

    const fromMs = Date.parse(dto.from);
    const toMs = Date.parse(dto.to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      // Let the @IsISO8601 validators report malformed dates.
      return true;
    }

    if (toMs < fromMs) {
      return false;
    }

    const interval = dto.interval ?? VolumeInterval.Day;
    const intervalMs = INTERVAL_MS[interval];
    const bucketCount = Math.floor((toMs - fromMs) / intervalMs) + 1;

    return bucketCount <= MAX_VOLUME_BUCKETS;
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as VolumeQueryDto;
    const interval = dto.interval ?? VolumeInterval.Day;
    return `The from/to range exceeds the maximum of ${MAX_VOLUME_BUCKETS} buckets for interval "${interval}"`;
  }
}

export class VolumeQueryDto {
  @IsOptional()
  @IsEnum(VolumeInterval)
  interval?: VolumeInterval = VolumeInterval.Day;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  asset?: string;

  @Validate(MaxVolumeBucketsConstraint)
  private readonly rangeCheck?: never;
}

export class TopAccountsQueryDto {
  @IsOptional()
  @IsEnum(TopAccountsDirection)
  direction?: TopAccountsDirection = TopAccountsDirection.From;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}