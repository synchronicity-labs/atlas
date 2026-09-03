import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { ContractsReportingService } from "./contracts-reporting.service";

@Module({
	imports: [MetabaseModule],
	providers: [ContractsReportingService],
	exports: [ContractsReportingService],
})
export class ContractsReportingModule {}
