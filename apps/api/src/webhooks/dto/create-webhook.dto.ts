import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, IsUrl } from "class-validator";
import type { WebhookFilter } from "@stellarlens/db";
import { IsValidWebhookFilter } from "./is-valid-webhook-filter.decorator";

export class CreateWebhookDto {
  @ApiProperty({
    description: "The URL that webhook events will be delivered to.",
    example: "https://example.com/webhooks/stellarlens",
  })
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiPropertyOptional({
    description: "The event types to subscribe to. If omitted, all events are delivered.",
    type: [String],
    example: ["payment.created", "payment.completed"],
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