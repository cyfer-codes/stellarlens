import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { IsValidStellarAddress } from "./is-stellar-address.decorator";

export class CreateContractDto {
  @IsString()
  @IsValidStellarAddress()
  address!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsString()
  @IsNotEmpty()
  network!: string;
}
