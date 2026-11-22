import {
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  registerDecorator,
  type ValidationOptions
} from "class-validator";

// Local-dev escape hatch: set ALLOW_INSECURE_WEBHOOK_URLS=true to permit plain http:// webhook
// urls (e.g. http://localhost:4000/hook). Read at validation time so it can't leak in by default.
function insecureWebhookUrlsAllowed(): boolean {
  return process.env.ALLOW_INSECURE_WEBHOOK_URLS === "true";
}

function IsSecureWebhookUrl(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isSecureWebhookUrl",
      target: object.constructor,
      propertyName,
      options: {
        message:
          "url must use https:// (plain http:// webhook urls are only allowed when ALLOW_INSECURE_WEBHOOK_URLS=true for local development)",
        ...validationOptions
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== "string") {
            return false;
          }
          let protocol: string;
          try {
            protocol = new URL(value).protocol;
          } catch {
            return false;
          }
          return protocol === "https:" || (protocol === "http:" && insecureWebhookUrlsAllowed());
        }
      }
    });
  };
}
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
  @IsSecureWebhookUrl()
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