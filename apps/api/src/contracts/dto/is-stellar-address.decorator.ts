import { type ValidationArguments, type ValidationOptions, registerDecorator } from "class-validator";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Validates that a property is a well-formed Stellar strkey: either a Soroban
 * contract (C...) or an Ed25519 account (G...) address. Both are 56-character,
 * base32-encoded SEP-23 strings with a valid checksum.
 *
 * Note: the indexer only matches registered addresses against contract events
 * (whose `contractId` is always a C... strkey), so a registered G... account
 * address won't currently be indexed. Both are accepted here so the API stays
 * consistent with the indexer's registry validation.
 */
export function IsValidStellarAddress(validationOptions?: ValidationOptions): PropertyDecorator {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isValidStellarAddress",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === "string" &&
            (StrKey.isValidContract(value) || StrKey.isValidEd25519PublicKey(value))
          );
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a well-formed Stellar contract (C...) or account (G...) strkey`;
        }
      }
    });
  };
}
