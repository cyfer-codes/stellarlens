import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { IsValidStellarAddress } from "./is-stellar-address.decorator";

export class CreateContractDto {
  @ApiProperty({
    description: "The Stellar contract address (C... or G... format).",
    example: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    required: true,
  })
  @IsString()
  @IsValidStellarAddress()
  address!: string;

  @ApiPropertyOptional({
    description: "A human-readable name for the contract.",
    example: "My Soroban Contract",
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: "The Stellar network the contract belongs to.",
    example: "testnet",
    enum: ["mainnet", "testnet", "futurenet", "custom"],
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  network!: string;
}