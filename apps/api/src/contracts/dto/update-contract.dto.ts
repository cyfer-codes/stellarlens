import { STELLAR_NETWORKS } from "@stellarlens/db";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from "class-validator";

export class UpdateContractDto {
  @ApiPropertyOptional({
    description: "Human-readable name for the contract. Set to null to clear it.",
    example: "My Stellar Contract",
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  })
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({
    description: "Stellar network the contract is deployed on.",
    example: "testnet",
    enum: [...STELLAR_NETWORKS],
    type: String,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @IsIn(STELLAR_NETWORKS)
  network?: string;
}