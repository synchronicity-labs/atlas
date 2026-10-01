import { Inject } from "@nestjs/common";
import { Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthMiddleware } from "../../trpc/middlewares/auth.middleware";
import { AtlasQbrService } from "./qbr.service";

@Router({ alias: "qbr" })
@UseMiddlewares(AuthMiddleware)
export class QbrRouter {
	constructor(@Inject(AtlasQbrService) private readonly qbr: AtlasQbrService) {}

	@Query()
	async report() {
		return this.qbr.exportReport("2026-Q3");
	}
}
