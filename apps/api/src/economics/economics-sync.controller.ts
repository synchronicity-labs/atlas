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
import { modalImport } from "./economics.contracts";
import { EconomicsService } from "./economics.service";

@Controller("internal/sync/modal")
export class EconomicsSyncController {
	private readonly secret: string | undefined;

	constructor(
		private readonly economics: EconomicsService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Post()
	@AllowAnonymous()
	import(
		@Body() body: unknown,
		@Headers("authorization") authorization?: string,
	) {
		this.authorize(authorization);
		const value = modalImport.parse(body);
		return this.economics.importModal(value);
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
