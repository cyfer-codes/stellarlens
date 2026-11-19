import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, Min } from "class-validator";


export enum ApiKeyScope {
  FULL = "full",
  READ = "read",
}

export class CreateApiKeyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ApiKeyScope)
  scope?: ApiKeyScope;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;
}