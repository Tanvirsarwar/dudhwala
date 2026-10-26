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
import { OutletsController } from './outlets/outlets.controller.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { InventoryService } from './inventory/inventory.service.js';
import { HealthController } from './health/health.controller.js';
import { RateLimitService } from './rate-limit/rate-limit.service.js';
import { SettingsService } from './settings/settings.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { JobsService } from './jobs/jobs.service.js';
import { MaintenanceJob } from './jobs/maintenance.js';
import { CatalogAdminController } from './catalog/catalog-admin.controller.js';
import { AvailabilityService } from './catalog/availability.service.js';
import { CatalogPublicController } from './catalog/catalog-public.controller.js';
import { CartService } from './cart/cart.service.js';
import { CartController } from './cart/cart.controller.js';
import { AddressesController } from './customers/addresses.controller.js';
import { SlotGenerator } from './delivery/delivery-config.service.js';
import { DeliveryAdminController } from './delivery/delivery-admin.controller.js';
import { PaymentGateway } from './payments/gateway.js';
import { FakeGateway, FakeGatewayController } from './payments/fake-gateway.js';
import { OutletHoursController } from './outlets/outlet-hours.controller.js';
import { StockCountsController } from './inventory/stock-counts.controller.js';
import { TransfersController } from './inventory/transfers.controller.js';
import { PrivacyController } from './customers/privacy.controller.js';
import { HTTP_FETCH, SslCommerzGateway, type HttpFetch } from './payments/sslcommerz-gateway.js';
import { PaymentsService } from './payments/payments.service.js';
import { OrdersService } from './orders/orders.service.js';
import { OrdersAdminController } from './orders/orders-admin.controller.js';
import { RiderController } from './orders/rider.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { CheckoutService } from './checkout/checkout.service.js';
import { CheckoutController } from './checkout/checkout.controller.js';
import { FinanceController } from './finance/finance.controller.js';
import { BootScheduler } from './jobs/boot-scheduler.js';
import { createMediaStorage, LocalMediaController, MediaService, MediaStorage } from './media/media.js';
import { ContentController } from './content/content.controller.js';

export interface AppOverrides {
  clock?: Clock;
  sms?: SmsSender;
  media?: MediaStorage;
  httpFetch?: HttpFetch;
}

@Module({})
export class AppModule {
  static forRoot(env: Env, overrides: AppOverrides = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: ENV, useValue: env },
      { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
      { provide: SmsSender, useValue: overrides.sms ?? createSmsSender(env) },
      PrismaService,
      AuditService,
      SessionService,
      OtpService,
      StaffAuthService,
      InventoryService,
      RateLimitService,
      SettingsService,
      JobsService,
      MaintenanceJob,
      AvailabilityService,
      CartService,
      SlotGenerator,
      { provide: HTTP_FETCH, useValue: overrides.httpFetch ?? (fetch as unknown as HttpFetch) },
      { provide: PaymentGateway, useClass: env.PAYMENTS_PROVIDER === 'sslcommerz' ? SslCommerzGateway : FakeGateway },
      PaymentsService,
      OrdersService,
      NotificationsService,
      CheckoutService,
      BootScheduler,
      { provide: MediaStorage, useValue: overrides.media ?? createMediaStorage(env) },
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
        OutletsController,
        InventoryController,
        SettingsController,
        CatalogAdminController,
        CatalogPublicController,
        CartController,
        AddressesController,
        DeliveryAdminController,
        CheckoutController,
        OrdersAdminController,
        RiderController,
        FinanceController,
        ContentController,
        OutletHoursController,
        StockCountsController,
        TransfersController,
        PrivacyController,
        ...(env.MEDIA_STORAGE === 'local' ? [LocalMediaController] : []),
        ...((env.NODE_ENV === 'development' || env.NODE_ENV === 'test') && env.SMS_PROVIDER === 'log' && env.ENABLE_DEV_OUTBOX === 'true' ? [DevSmsOutboxController] : []),
        ...(env.PAYMENTS_PROVIDER === 'fake' ? [FakeGatewayController] : []),
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
