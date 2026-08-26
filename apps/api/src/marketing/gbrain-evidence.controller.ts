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
import { validGbrainEvidenceAuthorization } from "./gbrain-evidence.auth";
import { gbrainEvidenceImport } from "./gbrain-evidence.contracts";
import { GbrainEvidenceService } from "./gbrain-evidence.service";

@Controller("internal/sync/gbrain/model-feedback")
export class GbrainEvidenceController {
	private readonly secret: string | undefined;

	constructor(
		private readonly evidence: GbrainEvidenceService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("ATLAS_GBRAIN_INGEST_SECRET", { infer: true });
	}

	@Post()
	@AllowAnonymous()
	ingest(
		@Body() body: unknown,
		@Headers("authorization") authorization?: string,
	) {
		if (!this.secret) {
			throw new ServiceUnavailableException(
				"gBrain ingestion is not configured.",
			);
		}
		if (!validGbrainEvidenceAuthorization(this.secret, authorization)) {
			throw new ForbiddenException();
		}
		return this.evidence.ingest(gbrainEvidenceImport.parse(body));
	}
}
