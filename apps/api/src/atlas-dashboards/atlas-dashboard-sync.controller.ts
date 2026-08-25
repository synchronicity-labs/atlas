import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Param,
	ParseIntPipe,
	Post,
	ServiceUnavailableException,
	UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import {
	AtlasDashboardsService,
	type AtlasRefreshMode,
} from "./atlas-dashboards.service";

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

	@Get(":number/:mode")
	@AllowAnonymous()
	viaModeGet(
		@Param("number", ParseIntPipe) number: number,
		@Param("mode") mode: string,
		@Headers("authorization") authorization?: string,
	) {
		return this.run(number, authorization, refreshMode(mode));
	}

	@Post(":number/:mode")
	@AllowAnonymous()
	viaModePost(
		@Param("number", ParseIntPipe) number: number,
		@Param("mode") mode: string,
		@Headers("authorization") authorization?: string,
	) {
		return this.run(number, authorization, refreshMode(mode));
	}

	private run(
		number: number,
		authorization?: string,
		mode: AtlasRefreshMode = "all",
	) {
		if (!this.secret) {
			throw new ServiceUnavailableException("Sync is not configured.");
		}
		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}
		return this.dashboards.refresh(number, mode);
	}
}

function refreshMode(value: string): AtlasRefreshMode {
	if (value === "native" || value === "metabase") return value;
	throw new UnprocessableEntityException("Unknown Atlas refresh mode.");
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return mismatch === 0;
}
