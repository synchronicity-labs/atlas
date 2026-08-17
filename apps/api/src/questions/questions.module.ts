import { Module } from "@nestjs/common";
import { BillingExperimentModule } from "../billing-experiment/billing-experiment.module";
import { EconomicsModule } from "../economics/economics.module";
import { MarketingModule } from "../marketing/marketing.module";
import { MetabaseModule } from "../metabase/metabase.module";
import { SalesModule } from "../sales/sales.module";
import { TrpcModule } from "../trpc/trpc.module";
import { QuestionsRouter } from "./questions.router";
import { QuestionsService } from "./questions.service";

@Module({
	imports: [
		TrpcModule,
		BillingExperimentModule,
		EconomicsModule,
		MarketingModule,
		MetabaseModule,
		SalesModule,
	],
	providers: [QuestionsService, QuestionsRouter],
	exports: [QuestionsService],
})
export class QuestionsModule {}
