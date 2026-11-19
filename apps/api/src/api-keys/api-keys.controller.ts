import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";
import { RequireScope } from "../auth/guards/require-scope.decorator";

@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @RequireScope("full")
  generate(@Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.generate(dto);
  }

  @Get()
  findAll() {
    return this.apiKeysService.findAll();
  }

  @Patch(":id")
  @RequireScope("full")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateApiKeyDto) {
    return this.apiKeysService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope("full")
  revoke(@Param("id", ParseIntPipe) id: number) {
    return this.apiKeysService.revoke(id);
  }
}