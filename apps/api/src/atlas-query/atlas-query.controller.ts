import {
	BadRequestException,
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
import {
	AtlasQbrReportQuery,
	AtlasQuestionQuery,
} from "./atlas-query.contracts";
import { AtlasQueryService } from "./atlas-query.service";
import { type AtlasQbrReport, AtlasQbrService } from "./qbr/qbr.service";

@Controller("internal/atlas")
export class AtlasQueryController {
	private readonly secret: string | undefined;

	constructor(
		private readonly atlas: AtlasQueryService,
		config: ConfigService<EnvironmentVariables, true>,
		private readonly qbr: AtlasQbrService,
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

	@Get("sources")
	@AllowAnonymous()
	sources(@Headers("authorization") authorization?: string) {
		this.authorize(authorization);
		return this.atlas.sources();
	}

	@Get("reports/qbr/:quarter")
	@AllowAnonymous()
	qbrReport(
		@Param("quarter") quarter: string,
		@Query() query: AtlasQbrReportQuery,
		@Headers("authorization") authorization?: string,
	) {
		this.authorize(authorization);
		return this.qbr
			.exportReport(quarter)
			.then((report) => projectQbrReport(report, query));
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

function projectQbrReport(report: AtlasQbrReport, query: AtlasQbrReportQuery) {
	if (query.view !== undefined && query.view !== "summary")
		throw new BadRequestException("view must be summary.");
	if (query.view && query.metricIds !== undefined)
		throw new BadRequestException("view and metricIds cannot be combined.");
	if (query.metricIds !== undefined) {
		const metricIds = query.metricIds.split(",");
		if (
			metricIds.length < 1 ||
			metricIds.length > 10 ||
			metricIds.some((id) => !id.trim()) ||
			new Set(metricIds).size !== metricIds.length
		)
			throw new BadRequestException(
				"metricIds must contain 1 to 10 unique, non-empty metric IDs.",
			);
		if (metricIds.some((id) => !Object.hasOwn(report.metrics, id)))
			throw new BadRequestException("metricIds contains an unknown metric ID.");
		return {
			...report,
			view: "detail" as const,
			metrics: Object.fromEntries(
				metricIds.map((id) => [id, report.metrics[id]]),
			),
		};
	}
	if (query.view !== "summary") return report;
	return {
		schemaVersion: report.schemaVersion,
		quarter: report.quarter,
		definitionVersion: report.definitionVersion,
		generatedAt: report.generatedAt,
		view: "summary" as const,
		metrics: Object.fromEntries(
			Object.entries(report.metrics).map(([id, metric]) => [
				id,
				{
					label: metric.label,
					unit: metric.unit,
					definition: metric.definition,
					question: metric.question,
					notApplicable: metric.notApplicable,
					automated: metric.automated,
					observations: metric.observations,
					supportingResultCount:
						metric.preparation.supportingResults?.length ?? 0,
				},
			]),
		),
	};
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return mismatch === 0;
}
