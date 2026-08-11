import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { MetabaseModule } from "../metabase/metabase.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ProductUsersRouter } from "./product-users.router";
import { ProductUsersService } from "./product-users.service";

@Module({
	imports: [TrpcModule, AgentModule, MetabaseModule],
	providers: [ProductUsersService, ProductUsersRouter],
	exports: [ProductUsersService],
})
export class ProductUsersModule {}
