import {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolResult,
} from "../contracts/index.js";
import { createHash } from "crypto";

export interface ResearchSearchParams {
  query: string;
  maxResults?: number;
}

export interface ResearchResultItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  provenance: {
    source: string;
    fetchedAt: string;
  };
}

export interface ResearchOutput {
  query: string;
  results: ResearchResultItem[];
  duplicateCount: number;
}

export interface SearchProvider {
  search(
    query: string,
    maxResults: number,
  ): Promise<Array<{ title: string; url: string; snippet: string }>>;
}

export class WebResearchTool implements Tool<
  ResearchSearchParams,
  ResearchOutput
> {
  metadata: ToolMetadata = {
    id: "web_research",
    name: "Web Research Tool",
    description:
      "Searches and retrieves web content with SHA-256 deduplication and untrusted data boundary handling.",
    safetyLevel: "SAFE",
  };

  private promptInjectionPatterns = [
    /ignore previous instructions/i,
    /system prompt override/i,
    /you are now in unrestricted mode/i,
    /bypass safety policies/i,
  ];

  constructor(private searchProvider?: SearchProvider) {}

  async execute(
    params: ResearchSearchParams,
    context: ExecutionContext,
  ): Promise<ToolResult<ResearchOutput>> {
    if (!params.query || params.query.trim().length === 0) {
      return { success: false, error: "Search query cannot be empty." };
    }

    const maxResults = params.maxResults || 5;

    let rawResults: Array<{ title: string; url: string; snippet: string }> = [];

    if (this.searchProvider) {
      try {
        rawResults = await this.searchProvider.search(params.query, maxResults);
      } catch (err: any) {
        return {
          success: false,
          error: `Search provider error: ${err.message}`,
        };
      }
    } else if (process.env.TAVILY_API_KEY) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: params.query,
            max_results: maxResults,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            error: `Tavily search API error (${res.status}): ${errText}`,
          };
        }
        const data = (await res.json()) as any;
        rawResults = (data.results || []).map((r: any) => ({
          title: r.title || "Untitled",
          url: r.url || "",
          snippet: r.content || r.snippet || "",
        }));
      } catch (err: any) {
        return {
          success: false,
          error: `Tavily search request failed: ${err.message}`,
        };
      }
    } else {
      return {
        success: false,
        error:
          "NOT_CONFIGURED: Web research search provider or API key (TAVILY_API_KEY) is missing in current production environment.",
      };
    }

    const seenHashes = new Set<string>();
    const sanitizedResults: ResearchResultItem[] = [];
    let duplicateCount = 0;

    const now = new Date().toISOString();

    for (const item of rawResults) {
      const sanitizedSnippet = this.sanitizeUntrustedContent(item.snippet);
      const contentHash = createHash("sha256")
        .update(`${item.url}:${sanitizedSnippet}`)
        .digest("hex");

      if (seenHashes.has(contentHash)) {
        duplicateCount++;
        continue;
      }

      seenHashes.add(contentHash);

      sanitizedResults.push({
        id: contentHash,
        title: item.title,
        url: item.url,
        snippet: sanitizedSnippet,
        provenance: {
          source: item.url,
          fetchedAt: now,
        },
      });
    }

    return {
      success: true,
      output: {
        query: params.query,
        results: sanitizedResults,
        duplicateCount,
      },
    };
  }

  private sanitizeUntrustedContent(snippet: string): string {
    if (!snippet) return "";
    let clean = snippet;
    for (const pattern of this.promptInjectionPatterns) {
      clean = clean.replace(pattern, "[MALICIOUS_PROMPT_INJECTION_REDACTED]");
    }
    return clean;
  }
}
