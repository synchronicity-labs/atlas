import { auth } from "@crm/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { ActivitiesModule } from "./activities/activities.module";
import { AtlasDashboardsModule } from "./atlas-dashboards/atlas-dashboards.module";
import { AtlasQueryModule } from "./atlas-query/atlas-query.module";
import { AuthModule } from "./auth/auth.module";
import { BackfillModule } from "./backfill/backfill.module";
import { BillingExperimentModule } from "./billing-experiment/billing-experiment.module";
import { AppCacheModule } from "./cache/cache.module";
import { CompaniesModule } from "./companies/companies.module";
import { validateEnv } from "./config/env.validation";
import { ContactsModule } from "./contacts/contacts.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrmModule } from "./crm/crm.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DealsModule } from "./deals/deals.module";
import { EconomicsModule } from "./economics/economics.module";
import { GoogleModule } from "./google/google.module";
import { HealthModule } from "./health/health.module";
import { LoggingModule } from "./logging/logging.module";
import { logAuthRoute } from "./logging/request-logger.middleware";
import { MarketingModule } from "./marketing/marketing.module";
import { MetabaseModule } from "./metabase/metabase.module";
import { MetricCatalogModule } from "./metric-catalog/metric-catalog.module";
import { ProductUsersModule } from "./product-users/product-users.module";
import { QuestionsModule } from "./questions/questions.module";
import { RudyModule } from "./rudy/rudy.module";
import { SalesModule } from "./sales/sales.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { SsoModule } from "./sso/sso.module";
import { TrpcModule } from "./trpc/trpc.module";
import { UsersModule } from "./users/users.module";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
	imports: [
		LoggingModule,
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
		AppCacheModule,
		DatabaseModule,
		CrmModule,
		BetterAuthModule.forRoot({ auth, middleware: logAuthRoute }),
		AuthModule,
		HealthModule,
		TrpcModule,
		UsersModule,
		CompaniesModule,
		ContactsModule,
		ConversationsModule,
		DealsModule,
		EconomicsModule,
		ActivitiesModule,
		AtlasDashboardsModule,
		AtlasQueryModule,
		DashboardModule,
		SearchModule,
		GoogleModule,
		MetabaseModule,
		MarketingModule,
		MetricCatalogModule,
		ProductUsersModule,
		QuestionsModule,
		RudyModule,
		SalesModule,
		SettingsModule,
		WorkspaceModule,
		SsoModule,
		BackfillModule,
		BillingExperimentModule,
	],
})
export class AppModule {}
