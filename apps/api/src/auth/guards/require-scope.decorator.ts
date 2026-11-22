import { SetMetadata } from "@nestjs/common";
import type { ApiKeyScope } from "@stellarlens/db";

export const REQUIRED_SCOPE_KEY = "requiredScope";
export const RequireScope = (scope: ApiKeyScope) => SetMetadata(REQUIRED_SCOPE_KEY, scope);
