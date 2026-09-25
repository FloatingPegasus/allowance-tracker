import { PROTECT_AT, rank, type LaneView } from "./engine";
import { bankedClause, formatBite, remainingPercent } from "./format";
import { resetPhrase } from "./time";
import type { AppState, Intent, Subscription } from "./types";

export interface Decision {
  pick: LaneView | null;
  alternatives: LaneView[];
  status: string;
  why: string;
  watch: string[];
  bank: string;
  relaxedHold: boolean;
}

export function decide(state: AppState, now: Date): Decision {
  if (state.subscriptions.length === 0) {
    return {
      pick: null,
      alternatives: [],
      status: "No subscriptions yet",
      why: "Add a seat and set its bars to what the provider shows.",
      watch: [],
      bank: "",
      relaxedHold: false,
    };
  }

  const ranked = rank(state.subscriptions, state.intent, state.holdCodex);
  return {
    pick: ranked.pick,
    alternatives: ranked.alternatives,
    status: statusLine(state.subscriptions, now),
    why: explain(ranked.pick, ranked.alternatives, state.holdCodex, ranked.relaxedHold),
    watch: watchList(state.subscriptions, now),
    bank: bankMessage(state.subscriptions, now),
    relaxedHold: ranked.relaxedHold,
  };
}

export function fullSentence(decision: Decision): string {
  if (!decision.pick) return `${decision.status} · No seat has room`;
  return `${decision.status} · Use ${decision.pick.lane.name}`;
}

function statusLine(subscriptions: Subscription[], now: Date): string {
  const clauses = [solClause(subscriptions, now), claudeClause(subscriptions), bankedClause(totalBanked(subscriptions))];
  return clauses.filter((clause) => clause.length > 0).join(" · ");
}

function solClause(subscriptions: Subscription[], now: Date): string {
  const seats = subscriptions.flatMap((subscription) => {
    const hasSol = subscription.lanes.some((lane) => lane.id === "sol" && lane.surface === "agent");
    const weekly = subscription.windows.find((window) => window.kind === "weekly");
    if (!hasSol || !weekly) return [];
    return [{ weekly }];
  });
  if (seats.length === 0) return "";
  const scarce = seats.reduce((best, seat) => (seat.weekly.usedPercent > best.weekly.usedPercent ? seat : best));
  if (!scarce.weekly.resetsAt) return "Sol weekly reset is unset";
  const phrase = resetPhrase(scarce.weekly.resetsAt, now);
  if (phrase === "is due") return "Sol weekly reset is due";
  return `Sol weekly resets ${phrase}`;
}

function claudeClause(subscriptions: Subscription[]): string {
  const claudes = subscriptions.flatMap((subscription) => {
    if (subscription.provider !== "claude") return [];
    const fiveHour = subscription.windows.find((window) => window.kind === "five_hour");
    return fiveHour ? [fiveHour] : [];
  });
  if (claudes.length === 0) return "";
  const fullest = claudes.reduce((best, window) => (window.usedPercent > best.usedPercent ? window : best));
  return `Claude 5h ${remainingPercent(fullest.usedPercent)}% left`;
}

function totalBanked(subscriptions: Subscription[]): number {
  return subscriptions.reduce((sum, subscription) => sum + subscription.bankedResets, 0);
}

function explain(pick: LaneView | null, alternatives: LaneView[], holdCodex: boolean, relaxedHold: boolean): string {
  if (!pick) {
    return "Every model that fits this work is out of room. Wait for a reset, or apply a banked reset if a Codex seat is what's blocking you.";
  }
  const sentences = [
    `One focused session moves the ${pick.tightest.label.toLowerCase()} bar by about ${formatBite(pick.tightest.effectiveShare)}.`,
  ];
  if (relaxedHold) {
    sentences.push("Claude and OpenCode can't take this session, so Codex is back in play.");
  } else if (holdCodex && pick.subscription.provider !== "codex" && pick.subscription.provider !== "chatgpt") {
    sentences.push("Codex stays untouched, so Sol's pool is still there for frontier work.");
  }
  const next = alternatives[0];
  if (next) {
    sentences.push(`Next is ${next.lane.name} on ${next.subscription.login} (${formatBite(next.bite)}).`);
  }
  return sentences.join(" ");
}

function watchList(subscriptions: Subscription[], now: Date): string[] {
  const lines: string[] = [];
  for (const subscription of subscriptions) {
    for (const window of subscription.windows) {
      if (window.usedPercent < PROTECT_AT) continue;
      const gatesWork = subscription.lanes.some((lane) => lane.surface === "agent" && lane.shares[window.kind] != null);
      if (!gatesWork) continue;
      const when = window.resetsAt ? resetPhrase(window.resetsAt, now) : "reset time unset";
      const timing = when === "is due" ? "the reset is due" : `resets ${when}`;
      lines.push(
        `${subscription.login} ${window.label.toLowerCase()} has ${remainingPercent(window.usedPercent)}% left and ${timing}.`,
      );
    }
  }
  return lines;
}

function bankMessage(subscriptions: Subscription[], now: Date): string {
  const total = totalBanked(subscriptions);
  if (total === 0) {
    return "No banked resets. A banked reset is a Codex refill you can hold and apply later. It is not credit, and buying an instant reset is separate — that one applies immediately and moves your weekly clock.";
  }
  const soon = subscriptions
    .filter((subscription) => subscription.bankedResets > 0)
    .flatMap((subscription) =>
      subscription.windows
        .filter((window) => window.kind === "weekly" && window.resetsAt)
        .map((window) => ({ subscription, window, at: new Date(window.resetsAt as string) })),
    )
    .filter(({ at }) => {
      const hours = (at.getTime() - now.getTime()) / 36e5;
      return hours >= 0 && hours < 36;
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const noun = bankedClause(total);
  const soonest = soon[0];
  if (soonest) {
    const phrase = resetPhrase(soonest.window.resetsAt as string, now);
    return `${noun}. Hold ${total === 1 ? "it" : "them"}. ${soonest.subscription.login} has ${remainingPercent(soonest.window.usedPercent)}% left and refills ${phrase}. Applying a reset now throws away what's left and moves the weekly clock.`;
  }

  const stalled = subscriptions
    .filter((subscription) => subscription.bankedResets > 0)
    .flatMap((subscription) =>
      subscription.windows
        .filter((window) => window.kind === "weekly" && window.usedPercent >= 85 && window.resetsAt)
        .map((window) => ({ subscription, window })),
    );
  const stuck = stalled[0];
  if (stuck?.window.resetsAt) {
    return `${noun}. ${stuck.subscription.login} weekly has ${remainingPercent(stuck.window.usedPercent)}% left and does not refill soon. Apply a reset only if that seat is actually blocking you.`;
  }

  return `${noun} stored. Apply one only when a Codex window is blocking work. It refreshes the 5-hour and weekly bars and reschedules the weekly reset.`;
}

export function intentHint(intent: Intent, holdCodex: boolean): string {
  if (intent === "frontier") return "Highest quality whose session stays under 10 points, on a seat that isn't already at 70%.";
  if (!holdCodex) return "Codex is in play. The smallest bite wins, even if it shares Sol's pool.";
  return intent === "spare"
    ? "Cheapest sessions. Codex stays banked."
    : "Strong models. Sol, Astra, and Opus stay banked.";
}
