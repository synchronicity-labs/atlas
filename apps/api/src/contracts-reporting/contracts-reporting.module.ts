import { Module } from "@nestjs/common";
import { ContractsReportingService } from "./contracts-reporting.service";

@Module({
	providers: [ContractsReportingService],
	exports: [ContractsReportingService],
})
export class ContractsReportingModule {}
