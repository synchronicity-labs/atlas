import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
	title: "Research key",
};

export default function ResearchKeyPage() {
	redirect("/dashboards");
}
