import {
  type ValidationArguments,
  type ValidationOptions,
  registerDecorator
} from "class-validator";
import type { WebhookFilter } from "@stellarlens/db";

export function isValidWebhookFilter(value: unknown): value is WebhookFilter {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.topics !== undefined && obj.topics !== null) {
    if (!Array.isArray(obj.topics)) {
      return false;
    }
    for (const item of obj.topics) {
      if (item !== null && typeof item !== "string") {
        return false;
      }
    }
  }
  return true;
}

export function IsValidWebhookFilter(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string | symbol) {
    registerDecorator({
      name: "isValidWebhookFilter",
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate: isValidWebhookFilter,
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an object with an optional topics array containing strings or null wildcards`;
        }
      }
    });
  };
}
