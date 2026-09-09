import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OperatorApiHandler, OperatorApiRequest } from "../api/operator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OperatorServerOptions {
  port?: number;
  host?: string;
  maxBodySizeBytes?: number;
  corsOrigin?: string;
  apiHandler: OperatorApiHandler;
  publicDir?: string;
}

export class OperatorWebServer {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private maxBodySizeBytes: number;
  private corsOrigin: string;
  private apiHandler: OperatorApiHandler;
  private publicDir: string;

  constructor(options: OperatorServerOptions) {
    this.port = options.port || 3000;
    this.host = options.host || "127.0.0.1";
    this.maxBodySizeBytes = options.maxBodySizeBytes || 1024 * 1024; // 1 MiB default
    this.corsOrigin = options.corsOrigin || "http://127.0.0.1:3000";
    this.apiHandler = options.apiHandler;
    this.publicDir =
      options.publicDir || path.resolve(__dirname, "../../src/web/public");
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("SERVER UNHANDLED ERROR:", err);
          if (!res.headersSent) {
            res.writeHead(500, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              JSON.stringify({
                success: false,
                error: "Internal Server Error",
              }),
            );
          }
        });
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort =
          typeof address === "object" && address ? address.port : this.port;
        this.port = actualPort;
        resolve(actualPort);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const hostHeader = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${hostHeader}`);
    const pathname = url.pathname;

    // Configured CORS origin handling
    res.setHeader("Access-Control-Allow-Origin", this.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. API Route: POST /api/v1/operator/chat
    if (pathname === "/api/v1/operator/chat" && req.method === "POST") {
      // Early Content-Length check
      const contentLengthHeader = req.headers["content-length"];
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > this.maxBodySizeBytes) {
          res.writeHead(413, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error:
                "Payload Too Large: Request body exceeds maximum allowed size.",
            }),
          );
          return;
        }
      }

      // Streaming request body accumulation with size enforcement
      let bodyStr = "";
      let accumulatedBytes = 0;
      let bodyExceeded = false;

      try {
        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk: Buffer) => {
            if (bodyExceeded) return;
            accumulatedBytes += chunk.length;
            if (accumulatedBytes > this.maxBodySizeBytes) {
              bodyExceeded = true;
              req.destroy(); // Stop receiving data
              reject(new Error("PAYLOAD_TOO_LARGE"));
              return;
            }
            bodyStr += chunk.toString("utf-8");
          });

          req.on("end", () => {
            if (!bodyExceeded) resolve();
          });

          req.on("error", (err) => {
            reject(err);
          });
        });
      } catch (err: any) {
        if (err.message === "PAYLOAD_TOO_LARGE" || bodyExceeded) {
          if (!res.headersSent) {
            res.writeHead(413, {
              "Content-Type": "application/json; charset=utf-8",
              Connection: "close",
            });
            res.end(
              JSON.stringify({
                success: false,
                error:
                  "Payload Too Large: Request body exceeds maximum allowed size.",
              }),
            );
          }
          return;
        }
        if (!res.headersSent) {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error: "Bad Request: Unable to read request stream.",
            }),
          );
        }
        return;
      }

      let body: any = {};
      if (bodyStr) {
        try {
          body = JSON.parse(bodyStr);
        } catch (jsonErr: any) {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            Connection: "close",
          });
          res.end(
            JSON.stringify({
              success: false,
              error: `Bad Request: Invalid JSON payload.`,
            }),
          );
          return;
        }
      }

      const apiReq: OperatorApiRequest = {
        headers: {
          authorization: req.headers.authorization,
        },
        body,
      };

      const apiRes = await this.apiHandler.handleChatRequest(apiReq);
      const payloadBuf = Buffer.from(JSON.stringify(apiRes.body), "utf-8");

      if (!res.headersSent) {
        res.writeHead(apiRes.statusCode, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": payloadBuf.length.toString(),
          Connection: "close",
        });
        res.end(payloadBuf);
      }
      return;
    }

    // 2. Web Interface Route: GET /Operator or GET /
    if (
      (pathname === "/Operator" ||
        pathname === "/operator" ||
        pathname === "/") &&
      req.method === "GET"
    ) {
      this.serveStaticFile(res, "index.html");
      return;
    }

    // 3. Static Assets: GET /app.css, /app.js, etc.
    if (req.method === "GET") {
      this.serveStaticFile(res, pathname);
      return;
    }

    // 4. Not Found
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  }

  private serveStaticFile(
    res: http.ServerResponse,
    requestedPath: string,
  ): void {
    // Strict path traversal prevention
    const safeBasename = path.basename(requestedPath);
    const targetPath = path.join(this.publicDir, safeBasename);

    // Verify resolved path stays strictly within publicDir
    const resolvedPublicDir = path.resolve(this.publicDir);
    const resolvedTargetPath = path.resolve(targetPath);

    if (!resolvedTargetPath.startsWith(resolvedPublicDir)) {
      res.writeHead(403, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden: Path traversal blocked.",
        }),
      );
      return;
    }

    if (
      !fs.existsSync(resolvedTargetPath) ||
      fs.statSync(resolvedTargetPath).isDirectory()
    ) {
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(JSON.stringify({ success: false, error: "Not Found" }));
      return;
    }

    const ext = path.extname(resolvedTargetPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };

    const contentType = contentTypeMap[ext];
    if (!contentType) {
      res.writeHead(403, {
        "Content-Type": "application/json; charset=utf-8",
        Connection: "close",
      });
      res.end(
        JSON.stringify({
          success: false,
          error: "Forbidden: Asset type not allowed.",
        }),
      );
      return;
    }

    const fileContent = fs.readFileSync(resolvedTargetPath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileContent.length.toString(),
      Connection: "close",
    });
    res.end(fileContent);
  }
}
