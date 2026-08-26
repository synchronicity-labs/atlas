import { z } from "zod";

export const q3InboundRow = z.object({
	weekStart: z.string().datetime({ offset: true }),
	periodEnd: z.string().datetime({ offset: true }),
	enterpriseInbound: z.number().int().min(0).max(1_000_000),
});

export const q3InboundImport = z
	.object({
		quarterStart: z.string().datetime({ offset: true }),
		dataThrough: z.string().datetime({ offset: true }),
		sourceItemCount: z.number().int().min(0).max(1_000_000),
		rows: z.array(q3InboundRow).min(1).max(20),
	})
	.superRefine((value, context) => {
		const quarterStart = new Date(value.quarterStart);
		const dataThrough = new Date(value.dataThrough);
		if (quarterStart.toISOString() !== "2026-07-01T00:00:00.000Z") {
			context.addIssue({
				code: "custom",
				message: "quarterStart must be 2026 Q3 UTC.",
			});
		}
		if (
			dataThrough.getUTCHours() !== 0 ||
			dataThrough.getUTCMinutes() !== 0 ||
			dataThrough.getUTCSeconds() !== 0 ||
			dataThrough.getUTCMilliseconds() !== 0 ||
			dataThrough <= quarterStart ||
			dataThrough > new Date("2026-10-01T00:00:00.000Z")
		) {
			context.addIssue({
				code: "custom",
				message: "dataThrough must be a Q3 UTC day boundary.",
			});
		}
		const rows = [...value.rows].sort(
			(left, right) => Date.parse(left.weekStart) - Date.parse(right.weekStart),
		);
		const expectedStarts = [quarterStart];
		for (
			let start = new Date("2026-07-06T00:00:00.000Z");
			start < dataThrough;
			start = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
		) {
			expectedStarts.push(start);
		}
		if (rows.length !== expectedStarts.length) {
			context.addIssue({
				code: "custom",
				message: "Inbound rows must cover every Q3 reporting period.",
			});
		}
		for (let index = 0; index < expectedStarts.length; index += 1) {
			const row = rows[index];
			if (!row) break;
			const start = new Date(row.weekStart);
			const end = new Date(row.periodEnd);
			const expectedStart = expectedStarts[index];
			const expectedEnd = expectedStarts[index + 1] ?? dataThrough;
			if (
				!expectedStart ||
				start.getTime() !== expectedStart.getTime() ||
				end.getTime() !== expectedEnd.getTime()
			) {
				context.addIssue({
					code: "custom",
					message:
						"Inbound rows must use the exact Q3 UTC reporting boundaries.",
				});
				break;
			}
		}
		if (
			new Date(rows.at(-1)?.periodEnd ?? "").getTime() !== dataThrough.getTime()
		) {
			context.addIssue({
				code: "custom",
				message: "Inbound rows must end at dataThrough.",
			});
		}
		if (
			rows.reduce((total, row) => total + row.enterpriseInbound, 0) !==
			value.sourceItemCount
		) {
			context.addIssue({
				code: "custom",
				message: "Inbound rows must reconcile to sourceItemCount.",
			});
		}
	});

export type Q3InboundImport = z.infer<typeof q3InboundImport>;
