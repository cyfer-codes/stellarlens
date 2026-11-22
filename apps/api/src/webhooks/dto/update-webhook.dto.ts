import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, IsUrl } from "class-validator";
import type { WebhookFilter } from "@stellarlens/db";
import { IsValidWebhookFilter } from "./is-valid-webhook-filter.decorator";

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

  @ApiPropertyOptional({
    description: "Optional structured filter for events, supporting positional topic matching and wildcards.",
    example: { topics: ["transfer", null, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"] },
    type: Object,
  })
  @IsOptional()
  @IsValidWebhookFilter()
  filter?: WebhookFilter;
}