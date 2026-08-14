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
import { MetricCatalogService } from "./metric-catalog.service";

@Controller("internal/sync/metric-catalog")
export class MetricCatalogSyncController {
	private readonly secret: string | undefined;

	constructor(
		private readonly catalog: MetricCatalogService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get()
	@AllowAnonymous()
	async syncViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post()
	@AllowAnonymous()
	async sync(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		this.authorize(authorization);
		return this.catalog.sync();
	}

	private authorize(authorization?: string): void {
		if (!this.secret) {
			throw new ServiceUnavailableException("Sync is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
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
