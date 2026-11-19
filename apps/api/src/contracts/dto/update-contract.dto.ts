import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, ValidateIf } from "class-validator";

export class UpdateContractDto {
  @ApiPropertyOptional({
    description: "Human-readable name for the contract. Set to null to clear it.",
    example: "My Stellar Contract",
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({
    description: "Stellar network the contract is deployed on.",
    example: "testnet",
    type: String,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  network?: string;
}