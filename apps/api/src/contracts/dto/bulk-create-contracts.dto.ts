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
  @IsString()
  address!: string;

  @IsString()
  network!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class BulkCreateContractsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkCreateContractItemDto)
  items!: BulkCreateContractItemDto[];
}
