import { Module } from "@nestjs/common";
import { BillingExperimentModule } from "../billing-experiment/billing-experiment.module";
import { EconomicsModule } from "../economics/economics.module";
import { MarketingModule } from "../marketing/marketing.module";
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
		SalesModule,
	],
	providers: [QuestionsService, QuestionsRouter],
})
export class QuestionsModule {}
