import {
	Body,
	Controller,
	ForbiddenException,
	Headers,
	Param,
	ParseIntPipe,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { validAtlasAuthoringAuthorization } from "./atlas-authoring.auth";
import { AtlasAuthoringService } from "./atlas-authoring.service";
import {
	parseAtlasQuestionDraft,
	parseAtlasQuestionPublish,
} from "./atlas-authoring.validation";

@Controller("internal/atlas/authoring")
export class AtlasAuthoringController {
	private readonly secret: string | undefined;

	constructor(
		private readonly authoring: AtlasAuthoringService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("ATLAS_AUTHORING_SECRET", { infer: true });
	}

	@Post("questions")
	@AllowAnonymous()
	create(
		@Body() body: unknown,
		@Headers("authorization") authorization?: string,
	) {
		this.authorize(authorization);
		return this.authoring.createDraft(parseAtlasQuestionDraft(body));
	}

	@Post("questions/:number/publish")
	@AllowAnonymous()
	publish(
		@Param("number", ParseIntPipe) number: number,
		@Body() body: unknown,
		@Headers("authorization") authorization?: string,
	) {
		this.authorize(authorization);
		return this.authoring.publishDraft(number, parseAtlasQuestionPublish(body));
	}

	private authorize(authorization?: string) {
		if (!this.secret) {
			throw new ServiceUnavailableException(
				"Atlas agent authoring is not configured.",
			);
		}
		if (!validAtlasAuthoringAuthorization(this.secret, authorization)) {
			throw new ForbiddenException();
		}
	}
}
