import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./health/health.module";
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
import { DashboardModule } from "./dashboard/dashboard.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
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
    DashboardModule,
    AdminModule,
  ],
})
export class AppModule {}
