import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { EventsModule } from "./events/events.module";
import { CatalogModule } from "./catalog/catalog.module";
import { InventoryModule } from "./inventory/inventory.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    IdentityModule,
    OrganizationsModule,
    EventsModule,
    CatalogModule,
    InventoryModule,
  ],
})
export class AppModule {}
