import {
	IsIn,
	IsISO8601,
	IsOptional,
	IsString,
	Matches,
	ValidateIf,
} from "class-validator";

export class AtlasQuestionQuery {
	@IsOptional()
	@Matches(/^(?!0000-)(?:\d{4}-Q[1-4]|\d{4}-\d{2}(?:-\d{2})?)$/)
	@ValidateIf((_object, value) => !/^(?!0000-)\d{4}-Q[1-4]$/.test(value))
	@IsISO8601({ strict: true })
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
