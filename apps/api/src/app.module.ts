import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from './config/env.js';
import { Clock, SystemClock } from './common/clock.js';
import { AllExceptionsFilter } from './common/http.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuditService } from './audit/audit.service.js';
import { AccessGuard } from './access/access.guard.js';
import { CsrfGuard } from './access/csrf.js';
import { SessionService } from './auth/session.service.js';
import { OtpService } from './auth/otp.service.js';
import { StaffAuthService } from './auth/staff-auth.service.js';
import { DevSmsOutboxController, HttpSmsSender, LogSmsSender, SmsSender } from './auth/sms.js';
import { AuthController, MeController } from './auth/auth.controller.js';
import { HealthController } from './health/health.controller.js';
import { RateLimitService } from './rate-limit/rate-limit.service.js';
import { SettingsService } from './settings/settings.service.js';
import { ConfigController } from './settings/config.controller.js';
import { OutletsController } from './outlets/outlets.controller.js';
import { OutletsService } from './outlets/outlets.service.js';
import { InventoryService } from './inventory/inventory.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { CatalogPublicController } from './catalog/catalog-public.controller.js';
import { CatalogAdminController } from './catalog/catalog-admin.controller.js';
import { CartService } from './cart/cart.service.js';
import { CartController } from './cart/cart.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersAdminController } from './orders/orders-admin.controller.js';
import { ContentController } from './content/content.controller.js';
import { MaintenanceJob } from './jobs/maintenance.js';
import { createMediaStorage, LocalMediaController, MediaService, MediaStorage } from './media/media.js';

export interface AppOverrides {
  clock?: Clock;
  sms?: SmsSender;
  media?: MediaStorage;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: ENV, useValue: env },
      { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
      { provide: SmsSender, useValue: overrides.sms ?? createSmsSender(env) },
      { provide: MediaStorage, useValue: overrides.media ?? createMediaStorage(env) },
      PrismaService,
      AuditService,
      SessionService,
      OtpService,
      StaffAuthService,
      RateLimitService,
      SettingsService,
      OutletsService,
      InventoryService,
      CatalogService,
      CartService,
      OrdersService,
      MaintenanceJob,
      MediaService,
      // Order matters: CSRF runs before session/permission checks.
      { provide: APP_GUARD, useClass: CsrfGuard },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ];
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        MeController,
        ConfigController,
        ContentController,
        OutletsController,
        CatalogPublicController,
        CatalogAdminController,
        CartController,
        OrdersController,
        OrdersAdminController,
        ...(env.MEDIA_STORAGE === 'local' ? [LocalMediaController] : []),
        ...((env.NODE_ENV === 'development' || env.NODE_ENV === 'test') && env.SMS_PROVIDER === 'log' && env.ENABLE_DEV_OUTBOX === 'true' ? [DevSmsOutboxController] : []),
      ],
      providers,
    };
  }
}

function createSmsSender(env: Env): SmsSender {
  if (env.SMS_PROVIDER === 'http') {
    return new HttpSmsSender({
      url: env.SMS_HTTP_URL,
      method: env.SMS_HTTP_METHOD,
      staticParams: env.SMS_HTTP_STATIC_PARAMS,
      toParam: env.SMS_HTTP_TO_PARAM,
      textParam: env.SMS_HTTP_TEXT_PARAM,
      phoneFormat: env.SMS_HTTP_PHONE_FORMAT,
      successPattern: env.SMS_HTTP_SUCCESS_PATTERN,
    });
  }
  return new LogSmsSender();
}
