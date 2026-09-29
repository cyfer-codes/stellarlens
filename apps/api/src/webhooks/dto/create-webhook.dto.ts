import { IsArray, IsOptional, IsString, IsUrl } from "class-validator";

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypes?: string[];
}
