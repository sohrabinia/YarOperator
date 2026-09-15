import { Brain, BrainInput, BrainResult } from "../contracts/index.js";

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

  private static readonly actionKeywords = [
    "بررسی کن",
    "بررسی‌کن",
    "پیدا کن",
    "پیداکن",
    "انجام بده",
    "انجام‌بده",
    "تحلیل کن",
    "بساز",
    "ایجاد کن",
    "ویرایش کن",
    "تغییر بده",
    "اصلاح کن",
    "اجرا کن",
    "ران کن",
    "پاک کن",
    "حذف کن",
    "نمایش بده",
    "نشان بده",
    "ارسال کن",
    "بفرست",
    "دانلود کن",
    "آپلود کن",
    "دیپلای کن",
    "تست کن",
    "دریافت کن",
    "به‌روزرسانی کن",
    "سایت",
    "اطلاعات",
    "برو سایت",
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

    const lowerText = text.toLowerCase();

    // 1. Check for action keywords / verbs
    const matchesAction = DeterministicBrain.actionKeywords.some((kw) =>
      lowerText.includes(kw),
    );

    if (matchesAction) {
      return {
        intent: "ACTION",
        confidence: 0.95,
        reason: "Input matches action-oriented keyword or imperative pattern.",
      };
    }

    // 2. Check for conversation patterns
    for (const pattern of DeterministicBrain.conversationalPatterns) {
      const matchesPattern = pattern.keywords.some((kw) =>
        lowerText.includes(kw),
      );
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
