import { IsISO8601, IsOptional, Matches } from "class-validator";

export class AtlasQuestionQuery {
	@IsOptional()
	@Matches(/^\d{4}-\d{2}(?:-\d{2})?$/)
	reportingPeriod?: string;

	@IsOptional()
	@IsISO8601({ strict: true })
	asOf?: string;
}
