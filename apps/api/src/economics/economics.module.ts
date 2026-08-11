import { Module } from "@nestjs/common";
import { EconomicsService } from "./economics.service";
import { EconomicsSyncController } from "./economics-sync.controller";

@Module({
	controllers: [EconomicsSyncController],
	providers: [EconomicsService],
	exports: [EconomicsService],
})
export class EconomicsModule {}
