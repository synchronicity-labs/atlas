import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Param,
	ParseIntPipe,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { AtlasDashboardsService } from "./atlas-dashboards.service";

@Controller("internal/sync/atlas")
export class AtlasDashboardSyncController {
	private readonly secret: string | undefined;

	constructor(
		private readonly dashboards: AtlasDashboardsService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get(":number")
	@AllowAnonymous()
	viaGet(
		@Param("number", ParseIntPipe) number: number,
		@Headers("authorization") authorization?: string,
	) {
		return this.run(number, authorization);
	}

	@Post(":number")
	@AllowAnonymous()
	viaPost(
		@Param("number", ParseIntPipe) number: number,
		@Headers("authorization") authorization?: string,
	) {
		return this.run(number, authorization);
	}

	private run(number: number, authorization?: string) {
		if (!this.secret) {
			throw new ServiceUnavailableException("Sync is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
		return this.dashboards.refresh(number);
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
