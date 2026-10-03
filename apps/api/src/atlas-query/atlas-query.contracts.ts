import {
	IsIn,
	IsISO8601,
	IsOptional,
	IsString,
	Matches,
} from "class-validator";

export class AtlasQuestionQuery {
	@IsOptional()
	@Matches(/^\d{4}-\d{2}(?:-\d{2})?$/)
	reportingPeriod?: string;

	@IsOptional()
	@IsISO8601({ strict: true })
	asOf?: string;
}

export class AtlasQbrReportQuery {
	@IsOptional()
	@IsIn(["summary"])
	view?: "summary";

	@IsOptional()
	@IsString()
	metricIds?: string;
}
