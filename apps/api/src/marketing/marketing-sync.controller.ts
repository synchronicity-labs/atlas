import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { MarketingService } from "./marketing.service";

@Controller("internal/sync/marketing")
export class MarketingSyncController {
	private readonly secret: string | undefined;

	constructor(
		private readonly marketing: MarketingService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get()
	@AllowAnonymous()
	async viaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post()
	@AllowAnonymous()
	async viaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private run(authorization?: string) {
		if (!this.secret) {
			throw new ServiceUnavailableException("Sync is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
		return this.marketing.syncDashboard(3);
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return mismatch === 0;
}
