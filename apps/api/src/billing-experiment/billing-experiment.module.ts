import { Module } from "@nestjs/common";
import { BillingExperimentService } from "./billing-experiment.service";

@Module({
	providers: [BillingExperimentService],
	exports: [BillingExperimentService],
})
export class BillingExperimentModule {}
