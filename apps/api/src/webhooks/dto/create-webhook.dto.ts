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

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  @IsSecureWebhookUrl()
  url!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventTypes?: string[];
}
