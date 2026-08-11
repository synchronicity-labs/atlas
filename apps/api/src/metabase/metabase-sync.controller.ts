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
import { MetabaseService } from "./metabase.service";

@Controller("internal/sync/metabase")
export class MetabaseSyncController {
	private readonly secret: string | undefined;

	constructor(
		private readonly metabase: MetabaseService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Post("incremental")
	@AllowAnonymous()
	async incremental(@Headers("authorization") authorization?: string) {
		return this.runIncremental(authorization);
	}

	@Post("users")
	@AllowAnonymous()
	async users(@Headers("authorization") authorization?: string) {
		return this.runUsers(authorization);
	}

	@Get("incremental")
	@AllowAnonymous()
	async incrementalViaGet(@Headers("authorization") authorization?: string) {
		return this.runIncremental(authorization);
	}

	@Get("users")
	@AllowAnonymous()
	async usersViaGet(@Headers("authorization") authorization?: string) {
		return this.runUsers(authorization);
	}

	@Get("backfill")
	@AllowAnonymous()
	async backfillViaGet(@Headers("authorization") authorization?: string) {
		return this.runBackfill(authorization);
	}

	@Post("backfill")
	@AllowAnonymous()
	async backfill(@Headers("authorization") authorization?: string) {
		return this.runBackfill(authorization);
	}

	private async runIncremental(authorization?: string) {
		this.authorize(authorization);
		const [users, dashboard] = await Promise.all([
			this.metabase.syncUsers({ maxBatches: 4 }),
			this.metabase.syncDashboard({ mode: "incremental", maxBatches: 4 }),
		]);
		const revenue = await this.metabase.syncAtlasDashboard(2);
		return { users, dashboard, revenue };
	}

	private async runUsers(authorization?: string) {
		this.authorize(authorization);
		return this.metabase.syncUsers({ maxBatches: 20 });
	}

	private async runBackfill(authorization?: string) {
		this.authorize(authorization);
		return this.metabase.syncDashboard({ mode: "backfill", maxBatches: 4 });
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
