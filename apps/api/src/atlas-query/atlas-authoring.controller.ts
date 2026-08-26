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
import { validAtlasAuthoringAuthorization } from "./atlas-authoring.auth";
import { atlasQuestionDraft } from "./atlas-authoring.contracts";
import { AtlasAuthoringService } from "./atlas-authoring.service";

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
		if (!this.secret) {
			throw new ServiceUnavailableException(
				"Atlas agent authoring is not configured.",
			);
		}
		if (!validAtlasAuthoringAuthorization(this.secret, authorization)) {
			throw new ForbiddenException();
		}
		return this.authoring.createDraft(atlasQuestionDraft.parse(body));
	}
}
