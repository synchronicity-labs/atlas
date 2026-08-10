import { z } from "zod";

const visualization = z.enum([
	"NUMBER",
	"LINE",
	"AREA",
	"BAR",
	"PIE",
	"TABLE",
	"FUNNEL",
	"TEXT",
]);

export const dashboardNumberInput = z.object({
	number: z.number().int().positive(),
});

export const dashboardRefreshInput = dashboardNumberInput;

export const dashboardLayoutInput = dashboardNumberInput.extend({
	tabNumber: z.number().int().positive(),
	items: z
		.array(
			z.object({
				id: z.string(),
				x: z.number().int().min(0).max(47),
				y: z.number().int().min(0).max(1_000),
				width: z.number().int().min(1).max(24),
				height: z.number().int().min(1).max(40),
				visualization,
			}),
		)
		.max(100),
});
