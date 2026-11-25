import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, type ThrottlerStorage } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";
import { ApiKeyThrottlerGuard } from "./guards/api-key-throttler.guard";
import { ApiKeyGuard } from "./guards/api-key.guard";

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL?.trim();
        let storage: ThrottlerStorage | undefined;

        if (redisUrl) {
          const redis = new Redis(redisUrl);
          storage = new ThrottlerStorageRedisService(redis);
        }

        return {
          throttlers: [
            {
              ttl: 60000,
              limit: 100
            }
          ],
          storage
        };
      }
    })
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard }
  ]
})
export class AuthModule {}
