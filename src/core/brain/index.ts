import {
  Brain,
  BrainInput,
  BrainResult,
  BrainPlan,
  BrainPlanStep,
  BrainPlanValidationResult,
  ActionGoalCategory,
} from "../contracts/index.js";

export function validateBrainPlan(plan: unknown): BrainPlanValidationResult {
  const errors: string[] = [];

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return {
      valid: false,
      errors: ["Plan must be a non-null object."],
    };
  }

  const p = plan as Record<string, unknown>;

  if (typeof p.goal !== "string" || p.goal.trim().length === 0) {
    errors.push("Plan 'goal' must be a non-empty string.");
  }

  if (!Array.isArray(p.steps) || p.steps.length === 0) {
    errors.push("Plan 'steps' must be a non-empty array.");
    return { valid: false, errors };
  }

  const seenStepIds = new Set<string>();
  const stepMap = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < p.steps.length; i++) {
    const step = p.steps[i];
    const stepIndexLabel = `Step[${i}]`;

    if (!step || typeof step !== "object" || Array.isArray(step)) {
      errors.push(`${stepIndexLabel} must be an object.`);
      continue;
    }

    const s = step as Record<string, unknown>;

    if (typeof s.id !== "string" || s.id.trim().length === 0) {
      errors.push(`${stepIndexLabel} must have a non-empty string 'id'.`);
    } else {
      if (seenStepIds.has(s.id)) {
        errors.push(`Duplicate step ID '${s.id}' found in plan.`);
      } else {
        seenStepIds.add(s.id);
        stepMap.set(s.id, s);
      }
    }

    if (typeof s.purpose !== "string" || s.purpose.trim().length === 0) {
      errors.push(`${stepIndexLabel} must have a non-empty string 'purpose'.`);
    }

    if (
      s.toolId !== undefined &&
      (typeof s.toolId !== "string" || s.toolId.trim().length === 0)
    ) {
      errors.push(
        `${stepIndexLabel} 'toolId' must be a non-empty string if provided.`,
      );
    }

    if (typeof s.action !== "string" || s.action.trim().length === 0) {
      errors.push(`${stepIndexLabel} must have a non-empty string 'action'.`);
    }

    if (
      s.params !== undefined &&
      (typeof s.params !== "object" ||
        s.params === null ||
        Array.isArray(s.params))
    ) {
      errors.push(`${stepIndexLabel} 'params' must be an object if provided.`);
    }

    if (s.dependsOn !== undefined) {
      if (!Array.isArray(s.dependsOn)) {
        errors.push(
          `${stepIndexLabel} 'dependsOn' must be an array of step IDs if provided.`,
        );
      } else {
        for (const depId of s.dependsOn) {
          if (typeof depId !== "string" || depId.trim().length === 0) {
            errors.push(
              `${stepIndexLabel} 'dependsOn' contains an invalid non-string or empty dependency ID.`,
            );
          }
        }
      }
    }
  }

  // Validate dependency existence and circular dependencies
  for (const [stepId, step] of stepMap.entries()) {
    const dependsOn = step.dependsOn as string[] | undefined;
    if (Array.isArray(dependsOn)) {
      for (const depId of dependsOn) {
        if (!stepMap.has(depId)) {
          errors.push(
            `Step '${stepId}' depends on unknown step ID '${depId}'.`,
          );
        } else if (depId === stepId) {
          errors.push(`Step '${stepId}' cannot depend on itself.`);
        }
      }
    }
  }

  // Check for circular dependencies using DFS graph cycle detection
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(currentId: string, path: string[]): boolean {
    visiting.add(currentId);
    path.push(currentId);

    const step = stepMap.get(currentId);
    const deps = (step?.dependsOn as string[]) || [];

    for (const depId of deps) {
      if (!stepMap.has(depId)) continue;
      if (visiting.has(depId)) {
        const cyclePath = [...path.slice(path.indexOf(depId)), depId].join(
          " -> ",
        );
        errors.push(`Circular dependency detected: ${cyclePath}`);
        return true;
      }
      if (!visited.has(depId)) {
        if (hasCycle(depId, path)) return true;
      }
    }

    visiting.delete(currentId);
    visited.add(currentId);
    path.pop();
    return false;
  }

  for (const stepId of stepMap.keys()) {
    if (!visited.has(stepId)) {
      hasCycle(stepId, []);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export type { ActionGoalCategory };

export interface KnowledgeEntity {
  id: string;
  name: string;
  aliases: string[];
}

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
      const plan: BrainPlan = {
        goal: text,
        steps: [
          {
            id: "step-1",
            purpose: `Execute ${resolvedActionGoal} goal on ${resolvedEntity ? resolvedEntity.name : "target"}`,
            action: resolvedActionGoal.toLowerCase(),
          },
        ],
      };

      return {
        intent: "ACTION",
        confidence: 0.95,
        reason: `Input matches actionable goal pattern (${resolvedActionGoal}${resolvedEntity ? ` on ${resolvedEntity.name}` : ""}).`,
        actionGoal: resolvedActionGoal,
        plan,
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
