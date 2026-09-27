import type { ConnectProvider } from "../domain/applyLogin";

export function AddAccount({ onAdd, busy }: { onAdd: (provider: ConnectProvider) => void; busy: boolean }) {
  return (
    <section id="add-subscription" className="connect">
      <h2>Connect an account</h2>
      <div className="provider-choices">
        <button disabled={busy} onClick={() => onAdd("chatgpt")}><strong>ChatGPT</strong><span>Sign in →</span></button>
        <button disabled={busy} onClick={() => onAdd("claude")}><strong>Claude</strong><span>Sign in →</span></button>
        <button disabled={busy} onClick={() => onAdd("opencode")}><strong>OpenCode</strong><span>API key →</span></button>
      </div>
    </section>
  );
}
