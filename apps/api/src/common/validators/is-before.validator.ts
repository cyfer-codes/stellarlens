import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions
} from "class-validator";

export function IsBefore(
  property: string,
  validationOptions?: ValidationOptions
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isBefore",
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];

          if (
            value === undefined ||
            value === null ||
            relatedValue === undefined ||
            relatedValue === null
          ) {
            return true;
          }

          if (typeof value !== "string" || typeof relatedValue !== "string") {
            return true;
          }

          const fromDate = new Date(value);
          const toDate = new Date(relatedValue);

          if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
            return true;
          }

          return fromDate <= toDate;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          return `'${args.property}' must be before or equal to '${relatedPropertyName}'`;
        }
      }
    });
  };
}
