import { Module } from "@nestjs/common";
import { RudyClient } from "./rudy.client";
import { RudyRouter } from "./rudy.router";
import { RudyService } from "./rudy.service";

@Module({
	providers: [RudyClient, RudyService, RudyRouter],
})
export class RudyModule {}
