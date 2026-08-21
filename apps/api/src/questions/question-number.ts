import type { Prisma } from "@crm/db";

export function questionNumberWhere(number: number): Prisma.QuestionWhereInput {
	return { publicNumber: number };
}
