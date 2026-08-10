import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Param,
	ParseIntPipe,
	Query,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { AtlasQuestionQuery } from "./atlas-query.contracts";
import { AtlasQueryService } from "./atlas-query.service";

@Controller("internal/atlas")
export class AtlasQueryController {
	private readonly secret: string | undefined;

	constructor(
		private readonly atlas: AtlasQueryService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("ATLAS_QUERY_SECRET", { infer: true });
	}

	@Get("catalog")
	@AllowAnonymous()
	catalog(@Headers("authorization") authorization?: string) {
		this.authorize(authorization);
		return this.atlas.catalog();
	}

	@Get("questions/:number")
	@AllowAnonymous()
	question(
		@Param("number", ParseIntPipe) number: number,
		@Query() query: AtlasQuestionQuery,
		@Headers("authorization") authorization?: string,
	) {
		this.authorize(authorization);
		return this.atlas.question(number, query);
	}

	private authorize(authorization?: string): void {
		if (!this.secret) {
			throw new ServiceUnavailableException(
				"The Atlas agent query surface is not configured.",
			);
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
