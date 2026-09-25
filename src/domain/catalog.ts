import type { AppState, ModelLane, OrgSeat, ProviderId, QuotaWindow, ReadingSource, Subscription, WindowKind } from "./types";
import { hoursFrom, nextMonthDay, nextWeekday } from "./time";

interface WindowDraft {
  kind: WindowKind;
  label: string;
  capacityWeight: number;
  hint: string;
  reset: (now: Date) => string;
  countCapacity?: number;
}

export interface Template {
  id: string;
  provider: ProviderId;
  plan: string;
  seat: string | null;
  notes: string;
  supportsBankedResets: boolean;
  windows: WindowDraft[];
  lanes: ModelLane[];
  /** Unverified monthly budget preset in USD. */
  listPrice?: number;
  /** Local workspace budget inputs; no provider billing integration. */
  org?: { seat: OrgSeat; unitAmount: number; workspace: string };
}

const codexLanes: ModelLane[] = [
  { id: "luna", name: "GPT-5.6 Luna", quality: 2, surface: "agent", shares: { five_hour: 3, weekly: 1 } },
  { id: "terra", name: "GPT-5.6 Terra", quality: 3, surface: "agent", shares: { five_hour: 8, weekly: 3 } },
  { id: "sol", name: "GPT-5.6 Sol", quality: 4, surface: "agent", shares: { five_hour: 20, weekly: 8 } },
  { id: "astra", name: "GPT-6 Astra", quality: 5, surface: "agent", shares: { five_hour: 40, weekly: 16 } },
];

const proLane = (share = 20): ModelLane => ({
  id: "gpt-pro",
  name: "GPT-6 Pro",
  quality: 5,
  surface: "chat",
  shares: { pro_messages: share },
});

const claudeLanes: ModelLane[] = [
  { id: "sonnet", name: "Claude Sonnet", quality: 3, surface: "agent", shares: { five_hour: 12, weekly: 4 } },
  { id: "opus", name: "Claude Opus", quality: 4, surface: "agent", shares: { five_hour: 24, weekly: 8 } },
];

const goLanes: ModelLane[] = [
  {
    id: "flash",
    name: "DeepSeek V4 Flash",
    quality: 1,
    surface: "agent",
    shares: { five_hour: 1.5, weekly: 0.6, monthly: 0.3 },
  },
  {
    id: "deepseek-pro",
    name: "DeepSeek V4 Pro",
    quality: 2,
    surface: "agent",
    shares: { five_hour: 8, weekly: 3, monthly: 1.5 },
  },
  {
    id: "glm",
    name: "GLM-5.2",
    quality: 3,
    surface: "agent",
    shares: { five_hour: 18, weekly: 7, monthly: 3.5 },
  },
  {
    id: "kimi",
    name: "Kimi K3",
    quality: 4,
    surface: "agent",
    shares: { five_hour: 45, weekly: 18, monthly: 9 },
  },
];

function friday(now: Date): string {
  return nextWeekday(now, 5, 17);
}

export const TEMPLATES: Template[] = [
  {
    id: "codex-business-standard",
    provider: "codex",
    plan: "Business",
    seat: "Standard",
    supportsBankedResets: true,
    org: { seat: "Standard", unitAmount: 25, workspace: "ChatGPT Business" },
    notes: "Models share the preset weekly and 5-hour pools. Session costs, message caps, resets and seat prices are planning assumptions. Confirm them against your account.",
    lanes: [...codexLanes, proLane()],
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 1,
        hint: "Preset pace window. Set the reset to the time on your usage bar.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 1,
        hint: "Preset shared weekly window. Use the reset shown in your account.",
        reset: friday,
      },
      {
        kind: "pro_messages",
        label: "Pro messages",
        capacityWeight: 1,
        countCapacity: 15,
        hint: "Preset: 15 messages per month. Confirm your account’s actual cap.",
        reset: (now) => nextMonthDay(now, 1, 0),
      },
    ],
  },
  {
    id: "codex-business-premium",
    provider: "codex",
    plan: "Business",
    seat: "Premium",
    supportsBankedResets: true,
    org: { seat: "Premium", unitAmount: 125, workspace: "ChatGPT Business" },
    notes: "This preset models a larger weekly pool without a 5-hour window. Its relative capacity, message cap and seat price are assumptions; confirm which limits apply to your account.",
    lanes: [...codexLanes, proLane()],
    windows: [
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 5,
        hint: "Preset: five times standard capacity. Confirm your account’s actual limit.",
        reset: friday,
      },
      {
        kind: "pro_messages",
        label: "Pro messages",
        capacityWeight: 50 / 15,
        countCapacity: 50,
        hint: "Preset: 50 messages per week. Confirm your account’s actual cap.",
        reset: friday,
      },
    ],
  },
  {
    id: "claude-pro",
    provider: "claude",
    plan: "Pro",
    seat: null,
    supportsBankedResets: false,
    listPrice: 20,
    notes: "This preset tracks 5-hour and weekly usage. Enter the readings and reset times shown in your account; session costs and monthly price are estimates.",
    lanes: claudeLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 1,
        hint: "Session window. Set the reset to the time Claude shows.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 1,
        hint: "Enter the weekly reset shown in Settings → Usage.",
        reset: (now) => nextWeekday(now, 3, 9),
      },
    ],
  },
  {
    id: "claude-max",
    provider: "claude",
    plan: "Max",
    seat: null,
    supportsBankedResets: false,
    listPrice: 100,
    notes: "This preset assumes five times the Pro capacity. Confirm your actual tier, readings, reset times and price before using its recommendations.",
    lanes: claudeLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 5,
        hint: "Larger session bucket. The bar is still 0–100% of this seat.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 5,
        hint: "Preset larger weekly allowance. Enter your actual reset time.",
        reset: (now) => nextWeekday(now, 3, 9),
      },
    ],
  },
  {
    id: "claude-team",
    provider: "claude",
    plan: "Team",
    seat: null,
    supportsBankedResets: false,
    org: { seat: "Team", unitAmount: 30, workspace: "Claude Team" },
    notes: "Tracks this account’s usage and a local seat-budget estimate. It does not retrieve a provider member list, invoice or workspace permissions.",
    lanes: claudeLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 1,
        hint: "This member's session window.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 1,
        hint: "This member's weekly reset.",
        reset: (now) => nextWeekday(now, 3, 9),
      },
    ],
  },
  {
    id: "opencode-go",
    provider: "opencode",
    plan: "Go",
    seat: null,
    supportsBankedResets: false,
    listPrice: 10,
    notes: "Tracks 5-hour, weekly and monthly percentages. Model costs and the monthly price are estimates; use the console for actual readings and reset times.",
    lanes: goLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 1,
        hint: "Enter the 5-hour percentage and reset shown in the console.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 1,
        hint: "Enter the weekly percentage and reset shown in the console.",
        reset: (now) => hoursFrom(now, 24 * 6),
      },
      {
        kind: "monthly",
        label: "Monthly",
        capacityWeight: 1,
        hint: "Enter the monthly percentage and reset shown in the console.",
        reset: (now) => hoursFrom(now, 24 * 20),
      },
    ],
  },
  {
    id: "chatgpt-plus",
    provider: "chatgpt",
    plan: "Plus",
    seat: null,
    supportsBankedResets: true,
    listPrice: 20,
    notes: "This preset tracks 5-hour and weekly usage. Recording a reset only updates this dashboard; it cannot buy or redeem provider capacity.",
    lanes: codexLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 1,
        hint: "Pace limit for Work and Codex.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 1,
        hint: "Preset weekly pool. Record a reset only after it occurs in the provider account.",
        reset: friday,
      },
    ],
  },
  {
    id: "chatgpt-pro",
    provider: "chatgpt",
    plan: "Pro",
    seat: null,
    supportsBankedResets: true,
    listPrice: 200,
    notes: "This preset assumes five times the Plus capacity with 5-hour and weekly windows. Confirm the actual limits and price in your account.",
    lanes: codexLanes,
    windows: [
      {
        kind: "five_hour",
        label: "5-hour",
        capacityWeight: 5,
        hint: "Still a pace limit, on a larger bucket.",
        reset: (now) => hoursFrom(now, 5),
      },
      {
        kind: "weekly",
        label: "Weekly",
        capacityWeight: 5,
        hint: "Preset weekly pool: five times the Plus capacity.",
        reset: friday,
      },
    ],
  },
];

export function getTemplate(id: string): Template {
  const template = TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`Unknown subscription template: ${id}`);
  return template;
}

export function findTemplateForPlan(provider: ProviderId, plan: string): Template | undefined {
  const normalized = plan.trim().toLowerCase();
  if (!normalized) return undefined;
  return TEMPLATES.find((item) => {
    const providerMatches =
      provider === "chatgpt" || provider === "codex"
        ? item.provider === "chatgpt" || item.provider === "codex"
        : item.provider === provider;
    if (!providerMatches) return false;
    const label = item.seat === "Premium" ? `${item.plan} Premium` : item.plan;
    return label.toLowerCase() === normalized;
  });
}

export interface UsageOverride {
  usedPercent?: number;
  countUsed?: number;
  resetsAt?: string;
}

export function createSubscription(options: {
  templateId: string;
  id: string;
  login: string;
  now: Date;
  bankedResets?: number;
  usage?: Partial<Record<WindowKind, UsageOverride>>;
  readingSource?: ReadingSource;
}): Subscription {
  const template = getTemplate(options.templateId);
  const bankedResets = options.bankedResets ?? 0;
  const windows: QuotaWindow[] = template.windows.map((draft) => {
    const usage = options.usage?.[draft.kind];
    const countCapacity = draft.countCapacity;
    let usedPercent = usage?.usedPercent ?? 0;
    let countUsed = usage?.countUsed;
    if (countCapacity != null && countUsed != null) {
      usedPercent = (countUsed / countCapacity) * 100;
    } else if (countCapacity != null) {
      countUsed = Math.round((usedPercent / 100) * countCapacity);
    }
    return {
      kind: draft.kind,
      label: draft.label,
      usedPercent,
      capacityWeight: draft.capacityWeight,
      resetsAt: usage?.resetsAt ?? draft.reset(options.now),
      hint: draft.hint,
      ...(countCapacity != null ? { countCapacity, countUsed: countUsed ?? 0 } : {}),
    };
  });

  return {
    id: options.id,
    templateId: template.id,
    provider: template.provider,
    plan: template.plan,
    seat: template.seat,
    login: options.login,
    notes: template.notes,
    windows,
    lanes: template.lanes.map((lane) => ({ ...lane, shares: { ...lane.shares } })),
    bankedResets,
    bankedResetExpiresAt: bankedResets > 0 ? hoursFrom(options.now, 24 * 21) : null,
    supportsBankedResets: template.supportsBankedResets,
    updatedAt: options.now.toISOString(),
    readingSource: options.readingSource ?? "manual",
    readingsKnown: options.readingSource === "seed",
  };
}

export function createSeed(now: Date): AppState {
  return {
    version: 1,
    intent: "balanced",
    holdCodex: true,
    subscriptions: [
      createSubscription({
        templateId: "codex-business-standard",
        id: "codex-standard",
        login: "standard seat",
        now,
        bankedResets: 1,
        readingSource: "seed",
        usage: {
          five_hour: { usedPercent: 46, resetsAt: hoursFrom(now, 2.75) },
          weekly: { usedPercent: 74 },
          pro_messages: { countUsed: 4 },
        },
      }),
      createSubscription({
        templateId: "codex-business-premium",
        id: "codex-premium",
        login: "premium seat",
        now,
        bankedResets: 1,
        readingSource: "seed",
        usage: {
          weekly: { usedPercent: 22 },
          pro_messages: { countUsed: 8 },
        },
      }),
      createSubscription({
        templateId: "claude-pro",
        id: "claude-pro",
        login: "claude pro",
        now,
        readingSource: "seed",
        usage: {
          five_hour: { usedPercent: 31, resetsAt: hoursFrom(now, 3.25) },
          weekly: { usedPercent: 44 },
        },
      }),
      createSubscription({
        templateId: "opencode-go",
        id: "go-primary",
        login: "go · primary",
        now,
        readingSource: "seed",
        usage: {
          five_hour: { usedPercent: 64, resetsAt: hoursFrom(now, 1.75) },
          weekly: { usedPercent: 31, resetsAt: hoursFrom(now, 24 * 4.2) },
          monthly: { usedPercent: 18, resetsAt: hoursFrom(now, 24 * 18) },
        },
      }),
      createSubscription({
        templateId: "opencode-go",
        id: "go-spare",
        login: "go · spare",
        now,
        readingSource: "seed",
        usage: {
          five_hour: { usedPercent: 12, resetsAt: hoursFrom(now, 4.5) },
          weekly: { usedPercent: 6, resetsAt: hoursFrom(now, 24 * 5.1) },
          monthly: { usedPercent: 3, resetsAt: hoursFrom(now, 24 * 22) },
        },
      }),
    ],
  };
}
