import { Module } from "@nestjs/common";
import { BillingExperimentModule } from "../billing-experiment/billing-experiment.module";
import { ContractsReportingModule } from "../contracts-reporting/contracts-reporting.module";
import { EconomicsModule } from "../economics/economics.module";
import { MarketingModule } from "../marketing/marketing.module";
import { MetabaseModule } from "../metabase/metabase.module";
import { SalesModule } from "../sales/sales.module";
import { TrpcModule } from "../trpc/trpc.module";
import { AtlasDashboardSyncController } from "./atlas-dashboard-sync.controller";
import { AtlasDashboardsRouter } from "./atlas-dashboards.router";
import { AtlasDashboardsService } from "./atlas-dashboards.service";

@Module({
	imports: [
		TrpcModule,
		BillingExperimentModule,
		ContractsReportingModule,
		EconomicsModule,
		MetabaseModule,
		MarketingModule,
		SalesModule,
	],
	controllers: [AtlasDashboardSyncController],
	providers: [AtlasDashboardsService, AtlasDashboardsRouter],
})
export class AtlasDashboardsModule {}
