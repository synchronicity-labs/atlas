import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { BillingExperimentService } from "./billing-experiment.service";

@Module({
	imports: [MetabaseModule],
	providers: [BillingExperimentService],
	exports: [BillingExperimentService],
})
export class BillingExperimentModule {}
