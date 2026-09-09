import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OperatorApiHandler, OperatorApiRequest } from "../api/operator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OperatorServerOptions {
  port?: number;
  apiHandler: OperatorApiHandler;
  publicDir?: string;
}

export class OperatorWebServer {
  private server: http.Server | null = null;
  private port: number;
  private apiHandler: OperatorApiHandler;
  private publicDir: string;

  constructor(options: OperatorServerOptions) {
    this.port = options.port || 3000;
    this.apiHandler = options.apiHandler;
    this.publicDir =
      options.publicDir || path.resolve(__dirname, "../../src/web/public");
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error("SERVER ERROR:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: `Internal Server Error: ${err.message}`,
              }),
            );
          }
        });
      });

      this.server.listen(this.port, () => {
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

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = url.pathname;

    // CORS headers for local execution
    res.setHeader("Access-Control-Allow-Origin", "*");
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
      try {
        const bodyStr = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => {
            chunks.push(chunk);
          });
          req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
          req.on("error", (err) => reject(err));
        });

        let body: any = {};
        if (bodyStr) {
          try {
            body = JSON.parse(bodyStr);
          } catch (jsonErr: any) {
            res.writeHead(400, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(
              JSON.stringify({
                success: false,
                error: `Invalid JSON payload: ${jsonErr.message}`,
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
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
          });
          res.end(
            JSON.stringify({
              success: false,
              error: err.message || "Server Error",
            }),
          );
        }
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

    // 3. Static Assets: GET /app.css, /app.js, /favicon.ico, etc.
    if (req.method === "GET") {
      const safeRelativePath = path
        .normalize(pathname)
        .replace(/^(\.\.[\/\\])+/, "");
      const fileName = path.basename(safeRelativePath);
      this.serveStaticFile(res, fileName);
      return;
    }

    // 4. Not Found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not Found" }));
  }

  private serveStaticFile(res: http.ServerResponse, fileName: string): void {
    const filePath = path.join(this.publicDir, fileName);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };

    const contentType = contentTypeMap[ext] || "application/octet-stream";
    const fileContent = fs.readFileSync(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileContent.length.toString(),
      Connection: "close",
    });
    res.end(fileContent);
  }
}
