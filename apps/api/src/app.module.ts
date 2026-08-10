import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./observability/metrics.module";
import { IdentityModule } from "./identity/identity.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { EventsModule } from "./events/events.module";
import { CatalogModule } from "./catalog/catalog.module";
import { InventoryModule } from "./inventory/inventory.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { OrdersModule } from "./orders/orders.module";
import { PaymentsModule } from "./payments/payments.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { TicketsModule } from "./tickets/tickets.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ValidatorModule } from "./validator/validator.module";
import { CheckinsModule } from "./checkins/checkins.module";
import { CouponsModule } from "./coupons/coupons.module";
import { ComplimentaryModule } from "./complimentary/complimentary.module";
import { MeModule } from "./me/me.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AdminModule } from "./admin/admin.module";
import { FinanceModule } from "./finance/finance.module";
import { RefundRequestsModule } from "./refund-requests/refund-requests.module";
import { WaitingRoomModule } from "./waiting-room/waiting-room.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { AddOnsModule } from "./add-ons/add-ons.module";
import { GuestListModule } from "./guest-list/guest-list.module";
import { RateLimitGuard } from "./common/rate-limit.guard";

@Module({
  imports: [
    // The API runs with `apps/api` as its cwd under pnpm/turbo, while the
    // workspace-level .env lives at the repository root. Load both locations
    // so local development and production launches from the repo root work.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
    }),
    HealthModule,
    MetricsModule,
    IdentityModule,
    OrganizationsModule,
    EventsModule,
    CatalogModule,
    InventoryModule,
    ReservationsModule,
    OrdersModule,
    PaymentsModule,
    WebhooksModule,
    TicketsModule,
    NotificationsModule,
    ValidatorModule,
    CheckinsModule,
    CouponsModule,
    ComplimentaryModule,
    MeModule,
    DashboardModule,
    AdminModule,
    FinanceModule,
    RefundRequestsModule,
    WaitingRoomModule,
    ReviewsModule,
    AddOnsModule,
    GuestListModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
