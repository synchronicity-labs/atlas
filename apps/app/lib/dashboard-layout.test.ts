import { expect, test } from "bun:test";
import type { Layout } from "react-grid-layout";
import {
	layoutToPersist,
	packDashboardLayout,
	stackDashboardLayout,
} from "./dashboard-layout";

test("a no-op edit preserves authored card coordinates", () => {
	const authored: Layout = [
		{ i: "left", x: 0, y: 0, w: 12, h: 6 },
		{ i: "right", x: 12, y: 1, w: 12, h: 6 },
	];
	const displayed = packDashboardLayout(authored);

	expect(displayed).not.toEqual(authored);
	expect(layoutToPersist(displayed, authored, false)).toEqual(authored);
	expect(layoutToPersist(displayed, authored, true)).toEqual(displayed);
});

test("dashboard rows fill the grid without gaps, overlaps, or mobile height inflation", () => {
	const saved: Layout = [
		{ i: "kpi", x: 0, y: 0, w: 8, h: 4 },
		{ i: "chart", x: 8, y: 0, w: 16, h: 6 },
		{ i: "remaining", x: 12, y: 12, w: 12, h: 6 },
		{ i: "second-kpi", x: 0, y: 18, w: 8, h: 4 },
		{ i: "table", x: 8, y: 18, w: 12, h: 6 },
	];
	const original = structuredClone(saved);
	const packed = packDashboardLayout(saved);
	expect(packed).toEqual([
		{ i: "kpi", x: 0, y: 0, w: 8, h: 6 },
		{ i: "chart", x: 8, y: 0, w: 16, h: 6 },
		{ i: "remaining", x: 0, y: 6, w: 24, h: 6 },
		{ i: "second-kpi", x: 0, y: 12, w: 8, h: 6 },
		{ i: "table", x: 8, y: 12, w: 16, h: 6 },
	]);
	expect(saved).toEqual(original);
	expect(packDashboardLayout(packed)).toEqual(packed);
	expect(packDashboardLayout([])).toEqual([]);

	const malformed: Layout = [
		{ i: "later", x: 0, y: 30, w: 12, h: 4 },
		{ i: "overlap", x: 4, y: 0, w: 16, h: 8 },
		{ i: "first", x: 0, y: 0, w: 16, h: 4 },
		{ i: "oversized", x: 20, y: 0, w: 32, h: 6 },
		{ i: "undersized", x: 0, y: 40, w: 0, h: 0 },
	];
	expect(packDashboardLayout(malformed)).toEqual([
		{ i: "first", x: 0, y: 0, w: 24, h: 4 },
		{ i: "overlap", x: 0, y: 4, w: 24, h: 8 },
		{ i: "oversized", x: 0, y: 12, w: 24, h: 6 },
		{ i: "later", x: 0, y: 18, w: 24, h: 4 },
		{ i: "undersized", x: 0, y: 22, w: 24, h: 3 },
	]);

	const mobile = stackDashboardLayout(packed, saved);
	expect(mobile.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))).toEqual([
		{ i: "kpi", x: 0, y: 0, w: 24, h: 4 },
		{ i: "chart", x: 0, y: 4, w: 24, h: 6 },
		{ i: "remaining", x: 0, y: 10, w: 24, h: 6 },
		{ i: "second-kpi", x: 0, y: 16, w: 24, h: 4 },
		{ i: "table", x: 0, y: 20, w: 24, h: 6 },
	]);

	const edited = packed.map((item) =>
		item.i === "kpi" ? { ...item, x: 16, y: 24, h: 9 } : item,
	);
	expect(stackDashboardLayout(edited, saved).at(-1)).toEqual({
		i: "kpi",
		x: 0,
		y: 22,
		w: 24,
		h: 4,
	});
	expect(edited.find((item) => item.i === "kpi")).toEqual({
		i: "kpi",
		x: 16,
		y: 24,
		w: 8,
		h: 9,
	});

	const regular: Layout = [
		...Array.from({ length: 4 }, (_, i) => ({
			i: `kpi-${i}`,
			x: i * 6,
			y: 0,
			w: 6,
			h: 4,
		})),
		{ i: "left", x: 0, y: 4, w: 12, h: 6 },
		{ i: "right", x: 12, y: 4, w: 12, h: 6 },
	];
	expect(packDashboardLayout(regular)).toEqual(regular);
});
