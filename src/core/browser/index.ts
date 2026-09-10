import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";

export interface BrowserNavigateParams {
  url: string;
  action?: "navigate" | "screenshot" | "click" | "fill";
  selector?: string;
  value?: string;
}

export interface BrowserObservation {
  url: string;
  title: string;
  contentSnippet: string;
  screenshotBase64?: string;
}

export interface BrowserDriver {
  navigate(url: string): Promise<{
    title: string;
    contentSnippet: string;
    screenshotBase64?: string;
  }>;
  click?(selector: string): Promise<void>;
  fill?(selector: string, value: string): Promise<void>;
  close(): Promise<void>;
}

export class BrowserTool implements Tool<
  BrowserNavigateParams,
  BrowserObservation
> {
  metadata: ToolMetadata = {
    id: "browser_operate",
    name: "Browser Operator",
    description:
      "Performs controlled browser navigation and observation with protocol restriction and form action boundaries.",
    safetyLevel: "SAFE",
  };

  private secretPattern =
    /(PASSWORD|SECRET|TOKEN|API_KEY)[=:\s]+["']?([^\s"']+)["']?/gi;

  constructor(private driverFactory?: () => Promise<BrowserDriver>) {}

  async execute(
    params: BrowserNavigateParams,
    context: ExecutionContext,
  ): Promise<ToolResult<BrowserObservation>> {
    if (!params.url) {
      return { success: false, error: "URL parameter is required." };
    }

    try {
      const parsedUrl = new URL(params.url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return {
          success: false,
          error: `Blocked protocol '${parsedUrl.protocol}'. Only http: and https: protocols are permitted.`,
        };
      }
    } catch (_err) {
      return { success: false, error: `Invalid URL provided: '${params.url}'` };
    }

    if (params.action === "fill" || params.action === "click") {
      if (!context.metadata?.approved) {
        return {
          success: false,
          error: `Browser action '${params.action}' requires explicit approval before execution.`,
        };
      }
    }

    let activeDriverFactory = this.driverFactory;
    if (!activeDriverFactory) {
      activeDriverFactory = async () => {
        try {
          const playwright = await import("playwright");
          const browser = await playwright.chromium.launch({ headless: true });
          const context = await browser.newContext();
          const page = await context.newPage();

          return {
            navigate: async (url: string) => {
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
              });
              const title = await page.title();
              const bodyText = (await page.textContent("body")) || "";
              const contentSnippet = bodyText.substring(0, 1000);
              return { title, contentSnippet };
            },
            click: async (selector: string) => {
              await page.click(selector, { timeout: 5000 });
            },
            fill: async (selector: string, value: string) => {
              await page.fill(selector, value, { timeout: 5000 });
            },
            close: async () => {
              await browser.close().catch(() => {});
            },
          };
        } catch (err: any) {
          throw new Error(
            `NOT_CONFIGURED: Playwright browser driver is unavailable (${err.message}).`,
          );
        }
      };
    }

    let driver: BrowserDriver | null = null;
    try {
      driver = await activeDriverFactory();
      const obs = await driver.navigate(params.url);

      if (params.action === "click" && params.selector && driver.click) {
        await driver.click(params.selector);
      } else if (
        params.action === "fill" &&
        params.selector &&
        params.value &&
        driver.fill
      ) {
        await driver.fill(params.selector, params.value);
      }

      return {
        success: true,
        output: {
          url: params.url,
          title: obs.title,
          contentSnippet: this.redactSecrets(obs.contentSnippet),
          screenshotBase64: obs.screenshotBase64,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Browser navigation error: ${err.message}`,
      };
    } finally {
      if (driver) {
        await driver.close().catch(() => {});
      }
    }
  }

  private redactSecrets(text: string): string {
    if (!text) return "";
    return text.replace(
      this.secretPattern,
      (_match, key) => `${key}=[REDACTED]`,
    );
  }
}
