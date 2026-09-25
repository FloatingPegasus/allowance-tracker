export function ProviderLogin({
  provider,
  connected,
  email,
  busy,
  error,
  onSignIn,
  onRefresh,
  onSignOut,
}: {
  provider: "openai" | "claude";
  connected: boolean;
  email: string | null;
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const name = provider === "openai" ? "ChatGPT" : "Claude";
  return (
    <div className="key-row">
      {connected ? (
        <>
          <p className="hint">
            {email ?? "Signed in"}
          </p>
          <div className="card-actions">
            <button type="button" className="solid" disabled={busy} onClick={onRefresh}>
              {busy ? "Reading…" : "Refresh usage"}
            </button>
            <button type="button" disabled={busy} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="solid" disabled={busy} onClick={onSignIn}>
            {busy ? "Opening…" : `Sign in with ${name}`}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
