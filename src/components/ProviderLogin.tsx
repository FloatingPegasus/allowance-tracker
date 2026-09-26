export function ProviderLogin({
  provider,
  connected,
  busy,
  error,
  onSignIn,
  onRefresh,
}: {
  provider: "openai" | "claude";
  connected: boolean;
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onRefresh: () => void;
}) {
  const name = provider === "openai" ? "ChatGPT" : "Claude";
  return (
    <div className="connection-actions">
      <button type="button" className={connected ? undefined : "solid"} disabled={busy} onClick={connected ? onRefresh : onSignIn}>
        {connected ? busy ? "Reading…" : "Refresh usage" : busy ? "Opening…" : `Sign in with ${name}`}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
