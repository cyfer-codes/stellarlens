import { IsEnum, IsOptional, IsString } from "class-validator";


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
}
