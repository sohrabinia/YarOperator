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
        "یارتریدر پروژه",
        "اون یار تریدر",
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
        "یار اوپراتور",
      ],
    },
    {
      id: "Amlakbashi",
      name: "Amlakbashi",
      aliases: [
        "amlakbashi",
        "amlaakbashi",
        "املاک‌باشی",
        "املاک باشی",
        "املاکباشی",
        "سایت املاک‌باشی",
        "سایت املاک باشی",
        "سایت املاکباشی",
      ],
    },
    {
      id: "GitHub",
      name: "GitHub",
      aliases: [
        "github",
        "گیتهاب",
        "گیت هاب",
        "گیت‌هاب",
        "repo",
        "repository",
        "ریپازیتوری",
        "مخزن",
      ],
    },
    {
      id: "Server",
      name: "Server",
      aliases: ["server", "سرور", "سرورم", "سرور پروژه", "سرورها"],
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
        "بررسیش کن ببین",
        "چک کن",
        "چکش کن",
        "چک کن ببین",
        "نگاه کن",
        "یه نگاهی بنداز",
        "وضعیتش رو ببین",
        "وضعیتش رو چک کن",
        "وضعیت سیستم",
        "وضعیت سرور",
        "وضعیت پروژه",
        "وضعیت",
        "رو ببین",
        "ببین چه خبره",
        "چه خبره",
        "ببین چه وضعیه",
        "چه وضعیه",
        "وضعیت رو بررسی کن",
        "مشکلش رو بررسی کن",
        "مشکل رو پیدا کن",
        "بفهم مشکل چیه",
        "علتش رو پیدا کن",
        "ریشه مشکل رو پیدا کن",
        "فورنزیک بررسی کن",
        "تحقیق کن",
        "تحقیقش کن",
        "پیدا کن",
        "ببین مشکل چیه",
        "ببین چی پیدا می‌کنی",
        "check",
        "inspect",
        "investigate",
        "look into",
        "review",
        "examine",
        "see what's wrong",
        "check the status",
        "check system status",
        "status",
      ],
    },
    {
      category: "DEVELOPMENT",
      phrases: [
        "درست کن",
        "درستش کن",
        "اصلاح کن",
        "اصلاحش کن",
        "رفع کن",
        "رفعش کن",
        "حل کن",
        "مشکلش رو حل کن",
        "باگ رو حل کن",
        "باگ رو برطرف کن",
        "برطرفش کن",
        "تغییر بده",
        "تغییرش بده",
        "کدش رو اصلاح کن",
        "کد رو اصلاح کن",
        "اضافه کن",
        "حذف کن",
        "پیاده‌سازی کن",
        "ارتقا بده",
        "ارتقاش بده",
        "به‌روزرسانی کن",
        "آپدیتش کن",
        "بهبودش بده",
        "بساز",
        "ایجاد کن",
        "ویرایش کن",
        "fix",
        "repair",
        "correct",
        "change",
        "modify",
        "implement",
        "add",
        "build",
        "create",
        "create pr",
        "create pull request",
        "open pr",
        "make pr",
        "improve",
        "upgrade",
        "update",
      ],
    },
    {
      category: "VERIFICATION",
      phrases: [
        "تست کن",
        "تستش کن",
        "تست بگیر",
        "تست‌ها رو اجرا کن",
        "صحتش رو بررسی کن",
        "مطمئن شو درست کار می‌کنه",
        "چک کن درست شده",
        "بررسی کن سالمه",
        "اعتبارسنجی کن",
        "تأیید کن",
        "build بگیر",
        "lint بگیر",
        "چک نهایی کن",
        "ببین درست شده یا نه",
        "اجرا کن",
        "ران کن",
        "test",
        "run tests",
        "run command",
        "run",
        "execute command",
        "execute",
        "verify",
        "validate",
        "confirm",
        "make sure it works",
      ],
    },
    {
      category: "RESEARCH",
      phrases: [
        "تحقیق کن",
        "درباره‌اش تحقیق کن",
        "بررسی اینترنتی کن",
        "در اینترنت بررسی کن",
        "برو ببین",
        "برو سایت رو ببین",
        "سایت رو بررسی کن",
        "برو سایت",
        "اطلاعاتش رو پیدا کن",
        "اطلاعات جمع کن",
        "ببین اینترنت چی میگه",
        "بگرد",
        "جستجو کن",
        "research",
        "search",
        "web research",
        "look online",
        "search the web",
        "browse the website",
        "find information",
        "collect information",
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
      keywords: ["سلام", "درود", "شب بخیر", "صبح بخیر", "روز بخیر", "وقت بخیر"],
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
      keywords: ["hello", "hi", "hey", "good morning", "good evening"],
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
