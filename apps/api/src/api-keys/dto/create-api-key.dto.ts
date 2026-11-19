import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsISO8601, IsOptional, IsString } from "class-validator";


export enum ApiKeyScope {
  FULL = "full",
  READ = "read",
}

export class CreateApiKeyDto {
  @ApiPropertyOptional({
    description: "Human-readable name for the API key",
    example: "CI pipeline key",
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Scope granted to the API key",
    enum: ApiKeyScope,
    enumName: "ApiKeyScope",
    example: ApiKeyScope.READ,
  })
  @IsOptional()
  @IsEnum(ApiKeyScope)
  scope?: ApiKeyScope;

  @ApiPropertyOptional({
    description: "ISO 8601 timestamp after which the key is invalid",
    format: "date-time",
    example: "2025-12-31T23:59:59.000Z",
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}