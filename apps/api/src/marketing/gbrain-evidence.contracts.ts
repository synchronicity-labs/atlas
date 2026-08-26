import { z } from "zod";

export const modelName = z.enum(["1.9", "2", "2-pro", "3"]);
export const supportTheme = z.enum([
	"lip_sync_timing",
	"mouth_or_face_quality",
	"visual_artifacts",
	"model_failure_or_error",
	"speaker_or_character",
	"general_quality",
	"other_negative",
]);

export const gbrainEvidenceRow = z.object({
	model: modelName,
	supportTheme,
	count: z.number().int().positive().max(1_000_000),
});

export const gbrainEvidenceImport = z
	.object({
		weekStart: z.string().datetime({ offset: true }),
		dataThrough: z.string().datetime({ offset: true }),
		sourceItemCount: z.number().int().min(0).max(1_000_000),
		rows: z.array(gbrainEvidenceRow).max(100),
	})
	.superRefine((value, context) => {
		const weekStart = new Date(value.weekStart);
		const dataThrough = new Date(value.dataThrough);
		if (
			weekStart.getUTCDay() !== 1 ||
			weekStart.getUTCHours() !== 0 ||
			weekStart.getUTCMinutes() !== 0 ||
			weekStart.getUTCSeconds() !== 0 ||
			weekStart.getUTCMilliseconds() !== 0
		) {
			context.addIssue({
				code: "custom",
				message: "weekStart must be Monday 00:00:00 UTC.",
			});
		}
		if (
			dataThrough.getTime() - weekStart.getTime() !==
			7 * 24 * 60 * 60 * 1000
		) {
			context.addIssue({
				code: "custom",
				message: "dataThrough must end the seven-day UTC week.",
			});
		}
		const keys = value.rows.map((row) => `${row.model}:${row.supportTheme}`);
		if (new Set(keys).size !== keys.length) {
			context.addIssue({
				code: "custom",
				message: "Support evidence rows must have unique model and theme keys.",
			});
		}
		if (
			value.rows.reduce((total, row) => total + row.count, 0) !==
			value.sourceItemCount
		) {
			context.addIssue({
				code: "custom",
				message: "Support evidence counts must reconcile to sourceItemCount.",
			});
		}
	});

export type GbrainEvidenceImport = z.infer<typeof gbrainEvidenceImport>;
