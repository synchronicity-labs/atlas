import { db } from "../src/client";

async function main() {
	console.log("Atlas does not seed fictional CRM records.");
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
