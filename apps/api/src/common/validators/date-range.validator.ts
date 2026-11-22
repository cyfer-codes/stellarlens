import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

export const DATE_RANGE_ORDER_MESSAGE = "from must be before or equal to to";

/**
 * Cross-field check for query DTOs with optional ISO 8601 `from` / `to` bounds.
 * Passes when either bound is missing (single-bound queries stay valid) or when a bound is malformed
 * (the per-field @IsISO8601 validators report those); fails only when `from` is after `to`.
 */
@ValidatorConstraint({ name: "dateRangeOrder", async: false })
export class DateRangeOrderConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { from, to } = args.object as { from?: unknown; to?: unknown };
    if (typeof from !== "string" || typeof to !== "string") {
      return true;
    }

    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return true;
    }

    return fromMs <= toMs;
  }

  defaultMessage(): string {
    return DATE_RANGE_ORDER_MESSAGE;
  }
}
