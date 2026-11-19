import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, IsUrl } from "class-validator";

export class UpdateWebhookDto {
  @ApiPropertyOptional({
    description: "The webhook endpoint URL that receives event payloads.",
    example: "https://example.com/webhooks/stellarlens",
    format: "uri",
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiPropertyOptional({
    description: "The list of event types this webhook should subscribe to.",
    example: ["transaction.created", "transaction.updated"],
    type: [String],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypes?: string[];
}