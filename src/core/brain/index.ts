import { Brain, BrainInput, BrainResult } from "../contracts/index.js";

export interface KnowledgeEntity {
  id: string;
  name: string;
  aliases: string[];
}

export type ActionGoalCategory =
  "INVESTIGATION" | "DEVELOPMENT" | "VERIFICATION" | "RESEARCH";

export class Normalizer {
  public static normalize(input: string): string {
    if (!input) return "";
    return input
      .trim()
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, " ") // Replace zero-width spaces / half-spaces with space
      .replace(/[\u200C]/g, " ") // Replace Persian ZWNJ (نیم‌فاصله) with space
      .replace(/[،,.:;؟!?\-\\_]/g, " ") // Normalize punctuation
      .replace(/\s+/g, " ") // Collapse multiple spaces
      .trim();
  }
}

export class OperatorKnowledgeBase {
  public static readonly entities: KnowledgeEntity[] = [
    {
      id: "YarTrader",
      name: "YarTrader",
      aliases: [
        "yartrader",
        "یار تریدر",
        "یارتریدر",
        "یار‌تریدر",
        "پروژه یار تریدر",
        "پروژه یارتریدر",
      ],
    },
    {
      id: "YarOperator",
      name: "YarOperator",
      aliases: [
        "yaroperator",
        "یار اپراتور",
        "یاراپراتور",
        "یار‌اپراتور",
        "اپراتور",
      ],
    },
    {
      id: "Amlakbashi",
      name: "Amlakbashi",
      aliases: [
        "amlakbashi",
        "املاک‌باشی",
        "املاک باشی",
        "املاکباشی",
        "سایت املاک‌باشی",
        "سایت املاک باشی",
      ],
    },
    {
      id: "GitHub",
      name: "GitHub",
      aliases: ["github", "گیتهاب", "گیت هاب", "گیت‌هاب"],
    },
    {
      id: "Server",
      name: "Server",
      aliases: ["server", "سرور", "سرورها"],
    },
    {
      id: "Production",
      name: "Production",
      aliases: ["production", "پروداکشن", "محیط پروداکشن"],
    },
  ];

  public static readonly actionVocabularies: Array<{
    category: ActionGoalCategory;
    phrases: string[];
  }> = [
    {
      category: "INVESTIGATION",
      phrases: [
        "بررسی کن",
        "بررسیش کن",
        "چک کن",
        "چکش کن",
        "ببین",
        "نگاه کن",
        "یه نگاهی بنداز",
        "وضعیتش رو ببین",
        "وضعیتش رو چک کن",
        "تحقیق کن",
        "تحقیقش کن",
        "پیدا کن",
        "مشکل رو پیدا کن",
        "علتش رو پیدا کن",
        "ریشه مشکل رو پیدا کن",
        "فورنزیک بررسی کن",
        "برو سایت",
      ],
    },
    {
      category: "DEVELOPMENT",
      phrases: [
        "درست کن",
        "اصلاح کن",
        "رفع کن",
        "حل کن",
        "برطرفش کن",
        "تغییر بده",
        "اضافه کن",
        "حذف کن",
        "پیاده‌سازی کن",
        "ارتقا بده",
        "به‌روزرسانی کن",
        "بساز",
        "ایجاد کن",
        "ویرایش کن",
      ],
    },
    {
      category: "VERIFICATION",
      phrases: [
        "تست کن",
        "تست‌ها رو اجرا کن",
        "build بگیر",
        "lint بگیر",
        "چک نهایی کن",
        "تأیید کن",
        "صحتش رو بررسی کن",
        "اجرا کن",
        "ران کن",
      ],
    },
    {
      category: "RESEARCH",
      phrases: [
        "بگرد",
        "جستجو کن",
        "تحقیق کن",
        "پیدا کن",
        "اطلاعاتش رو دربیار",
        "ببین چی پیدا می‌کنی",
      ],
    },
  ];

  public static readonly technicalConcepts = [
    "architecture",
    "component",
    "module",
    "interface",
    "contract",
    "implementation",
    "integration",
    "dependency",
    "runtime",
    "compile",
    "build",
    "test",
    "regression",
    "bug",
    "error",
    "failure",
    "reproduce",
    "root cause",
    "diagnosis",
    "repository",
    "repo",
    "branch",
    "commit",
    "sha",
    "head",
    "diff",
    "patch",
    "pr",
    "pull request",
    "merge",
    "server",
    "service",
    "process",
    "port",
    "logs",
    "production",
    "deployment",
    "website",
    "browser",
    "session",
    "authentication",
    "authorization",
    "fail closed",
    "least privilege",
    "approval",
  ];

  public static resolveEntity(input: string): KnowledgeEntity | undefined {
    const normInput = Normalizer.normalize(input);
    for (const entity of this.entities) {
      for (const alias of entity.aliases) {
        const normAlias = Normalizer.normalize(alias);
        if (normInput.includes(normAlias)) {
          return entity;
        }
      }
    }
    return undefined;
  }

  public static resolveActionGoal(
    input: string,
  ): ActionGoalCategory | undefined {
    const normInput = Normalizer.normalize(input);
    for (const vocab of this.actionVocabularies) {
      for (const phrase of vocab.phrases) {
        const normPhrase = Normalizer.normalize(phrase);
        if (normInput.includes(normPhrase)) {
          return vocab.category;
        }
      }
    }
    return undefined;
  }
}

export class DeterministicBrain implements Brain {
  private static readonly conversationalPatterns: Array<{
    keywords: string[];
    reply: string;
  }> = [
    {
      keywords: ["سلام", "درود"],
      reply: "سلام! در خدمتم. چه کاری برایتان انجام دهم؟",
    },
    {
      keywords: ["خوبی", "چطوری", "چطورید"],
      reply: "ممنون، من خوبم! شما چطورید؟ چه کاری می‌توانم برایتان انجام دهم؟",
    },
    {
      keywords: ["ممنون", "مرسی", "تشکر", "سپاس"],
      reply: "خواهش می‌کنم! خوشحال می‌شوم کمکتان کنم.",
    },
    {
      keywords: ["خداحافظ", "خدا نگهدار", "فعلا", "بای"],
      reply: "خداحافظ! روز خوبی داشته باشید.",
    },
    {
      keywords: ["hello", "hi", "hey"],
      reply: "Hello! How can I assist you today?",
    },
  ];

  public interpret(input: BrainInput): BrainResult {
    const text = input?.rawCommandText?.trim() ?? "";
    if (!text) {
      return {
        intent: "AMBIGUOUS",
        confidence: 0,
        reason: "Empty or invalid command input.",
      };
    }

    const normText = Normalizer.normalize(text);
    const resolvedActionGoal = OperatorKnowledgeBase.resolveActionGoal(text);
    const resolvedEntity = OperatorKnowledgeBase.resolveEntity(text);

    // 1. If an action goal / verb phrase is present, classify as ACTION regardless of greetings
    // (Greeting + Action -> ACTION rule)
    if (resolvedActionGoal) {
      return {
        intent: "ACTION",
        confidence: 0.95,
        reason: `Input matches actionable goal pattern (${resolvedActionGoal}${resolvedEntity ? ` on ${resolvedEntity.name}` : ""}).`,
      };
    }

    // 2. Check for conversation patterns (CONVERSATION for pure greetings/pleasantries)
    for (const pattern of DeterministicBrain.conversationalPatterns) {
      const matchesPattern = pattern.keywords.some((kw) => {
        const normKw = Normalizer.normalize(kw);
        return normText.includes(normKw);
      });
      if (matchesPattern) {
        return {
          intent: "CONVERSATION",
          reply: pattern.reply,
          confidence: 0.95,
          reason: "Input matches conversational greeting or pleasantry.",
        };
      }
    }

    // 3. Ambiguous / Fail Closed fallback
    return {
      intent: "AMBIGUOUS",
      confidence: 0.2,
      reason:
        "Input could not be deterministically classified as CONVERSATION or ACTION.",
    };
  }
}
