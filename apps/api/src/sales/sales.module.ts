import { Module } from "@nestjs/common";
import { MetabaseModule } from "../metabase/metabase.module";
import { SalesService } from "./sales.service";

@Module({
	imports: [MetabaseModule],
	providers: [SalesService],
	exports: [SalesService],
})
export class SalesModule {}
