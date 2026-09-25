import type { Decision } from "../domain/present";
import { formatBite, formatSessions, remainingLabel, seatLine } from "../domain/format";
import { INTENTS } from "../domain/engine";
import { intentHint } from "../domain/present";
import type { Intent } from "../domain/types";

interface Props {
  decision: Decision;
  intent: Intent;
  holdCodex: boolean;
  onIntent: (intent: Intent) => void;
  onHold: (holdCodex: boolean) => void;
}

export function Hero({ decision, intent, holdCodex, onIntent, onHold }: Props) {
  return (
    <section className="hero" aria-label="Recommendation">
      <p className="section-label">Session planner <span>Estimated from your readings</span></p>
      <div className="intent">
        <div role="group" aria-label="Kind of work">
          {(Object.keys(INTENTS) as Intent[]).map((key) => (
            <button key={key} type="button" aria-pressed={intent === key} onClick={() => onIntent(key)}>
              {INTENTS[key].label}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={holdCodex} onClick={() => onHold(!holdCodex)}>
          Hold Codex
        </button>
      </div>

      <h2 data-testid="headline" aria-live="polite">
        <span className="status">{decision.status}</span>
        {decision.pick ? (
          <span className="use">
            <em>{decision.pick.lane.name}</em>
          </span>
        ) : (
          <span className="use">No matching account available</span>
        )}
      </h2>
      {decision.pick && (
        <p className="where">
          {seatLine(decision.pick.subscription.provider, decision.pick.subscription.plan, decision.pick.subscription.seat)}
          {" · "}
          {decision.pick.subscription.login}
          {" · "}
          {formatSessions(decision.pick.sessions)}
          {" · "}
          {formatBite(decision.pick.bite)} bite
        </p>
      )}
      <details className="planner-detail"><summary>How this was estimated</summary><p className="intent-hint">{intentHint(intent, holdCodex)}</p><p className="why">{decision.why}</p>
      {decision.alternatives.length > 0 && (
        <ol className="alts">
          {decision.alternatives.map((alternative) => (
            <li key={`${alternative.subscription.id}-${alternative.lane.id}`}>
              <strong>{alternative.lane.name}</strong>
              <span>{alternative.subscription.login}</span>
              <span>{formatBite(alternative.bite)} bite</span>
              <span>
                {alternative.tightest.label} {remainingLabel(alternative.tightest.usedPercent)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {decision.watch.length > 0 && (
        <ul className="watch">
          {decision.watch.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {decision.bank && <p className="bank">{decision.bank}</p>}
      </details>
    </section>
  );
}
