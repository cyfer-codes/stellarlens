import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested
} from "class-validator";

/**
 * A single item of a bulk registration request.
 *
 * Only the shape is validated here: an item whose `address` or `network` is
 * missing or malformed comes back as a per-item `error` result instead of
 * failing the whole batch with a 400. The envelope (`items` itself) is still
 * validated as a whole.
 */
export class BulkCreateContractItemDto {
  @ApiProperty({
    description: "Contract address (e.g. a Stellar contract ID).",
    example: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
  })
  @IsString()
  address!: string;

  @ApiProperty({
    description: "Network the contract lives on.",
    example: "testnet"
  })
  @IsString()
  network!: string;

  @ApiPropertyOptional({
    description: "Optional human-readable name for the contract.",
    example: "My Token"
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class BulkCreateContractsDto {
  @ApiProperty({
    description:
      "Contracts to register. Between 1 and 100 items. Items with missing or malformed fields are reported as per-item errors rather than failing the whole batch.",
    type: () => [BulkCreateContractItemDto],
    minItems: 1,
    maxItems: 100
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkCreateContractItemDto)
  items!: BulkCreateContractItemDto[];
}