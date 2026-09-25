(() => {
  const allowed = new Set(["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]);
  if (!allowed.has(location.origin) || location.pathname !== "/") return;
  let busy = false;
  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== "allowance:browser-request" || typeof event.data.requestId !== "string") return;
    const { requestId, accounts } = event.data;
    if (busy) return;
    busy = true;
    window.postMessage({ type: "allowance:browser-ready", requestId }, location.origin);
    try {
      const result = await chrome.runtime.sendMessage({ type: "allowance:sync", accounts });
      window.postMessage({ type: "allowance:browser-result", requestId, ...result }, location.origin);
    } catch {
      window.postMessage({ type: "allowance:browser-result", requestId, error: "Reload the tracker after installing or updating the browser connection." }, location.origin);
    } finally { busy = false; }
  });
})();
