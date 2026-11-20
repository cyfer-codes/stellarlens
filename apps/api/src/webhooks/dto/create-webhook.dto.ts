import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, IsUrl } from "class-validator";

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
}