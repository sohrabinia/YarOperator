import path from "node:path";
import { OperatorWebServer } from "./server.js";
import { bootstrapOperatorApplication } from "../core/bootstrap/index.js";

export async function createProductionServer(options?: {
  port?: number;
  host?: string;
  bearerToken?: string;
  ownerId?: string;
}): Promise<{ server: OperatorWebServer; port: number }> {
  const apiHandler = bootstrapOperatorApplication({
    bearerToken: options?.bearerToken,
    ownerId: options?.ownerId,
  });

  const targetPort =
    options?.port !== undefined
      ? options.port
      : parseInt(process.env.PORT || "3000", 10);

  const targetHost = options?.host || process.env.HOST || "127.0.0.1";

  const server = new OperatorWebServer({
    port: targetPort,
    host: targetHost,
    apiHandler,
  });

  const actualPort = await server.start();
  return { server, port: actualPort };
}

// Launched directly via node ./dist/web/index.js
if (
  process.argv[1] &&
  path.normalize(process.argv[1]).endsWith(path.normalize("web/index.js"))
) {
  createProductionServer()
    .then(({ server, port }) => {
      console.log(
        `[YarOperator] Web Server running at http://${server.getHost()}:${port}/Operator`,
      );

      const shutdown = async () => {
        console.log("\n[YarOperator] Gracefully shutting down web server...");
        await server.stop();
        console.log("[YarOperator] Server stopped.");
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      console.error("[YarOperator] Server startup failed:", err);
      process.exit(1);
    });
}
