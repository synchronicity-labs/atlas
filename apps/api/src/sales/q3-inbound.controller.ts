import {
	Body,
	Controller,
	ForbiddenException,
	Headers,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { validQ3InboundAuthorization } from "./q3-inbound.auth";
import { q3InboundImport } from "./q3-inbound.contracts";
import { Q3InboundService } from "./q3-inbound.service";

@Controller("internal/sync/rudy/q3-inbound")
export class Q3InboundController {
	private readonly secret: string | undefined;

	constructor(
		private readonly inbound: Q3InboundService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("ATLAS_Q3_GTM_INGEST_SECRET", { infer: true });
	}

	@Post()
	@AllowAnonymous()
	ingest(
		@Body() body: unknown,
		@Headers("authorization") authorization?: string,
	) {
		if (!this.secret) {
			throw new ServiceUnavailableException(
				"Q3 inbound ingestion is not configured.",
			);
		}
		if (!validQ3InboundAuthorization(this.secret, authorization)) {
			throw new ForbiddenException();
		}
		return this.inbound.ingest(q3InboundImport.parse(body));
	}
}
