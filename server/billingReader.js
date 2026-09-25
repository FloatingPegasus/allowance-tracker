// Runs inside the temporary provider page. Only normalized account fields leave it.
export async function readAccount(target, fetcher = fetch) {
  const observedAt = new Date().toISOString();
  const deadline = Date.now() + 45000;
  const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v) => typeof v === "string" && v.length <= 200 ? v : null;
  const count = (v) => Number.isSafeInteger(v) && v >= 0 ? v : null;
  const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
  const currency = (v) => typeof v === "string" && /^[a-z]{3}$/i.test(v) ? v.toUpperCase() : null;
  const seatName = (v) => (v === "default" ? "Standard" : v === "prolite" ? "Premium" : text(v));
  const role = (v) => (v === "account-owner" ? "owner" : v === "account-admin" ? "admin" : v === "standard-user" ? "member" : null);
  const failed = (message) => ({ data: null, updatedAt: null, error: message });
  const section = async (work) => {
    try { return { data: await work(), updatedAt: observedAt, error: null }; }
    catch (error) { return failed(error instanceof Error ? error.message : "Account details could not be read."); }
  };
  const request = async (path, headers = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Account sync timed out. Try again.");
    let response;
    try { response = await fetcher(`https://chatgpt.com${path}`, { method: "GET", credentials: "include", cache: "no-store", redirect: "error", headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(Math.min(15000, remaining)) }); }
    catch { throw new Error("ChatGPT could not be reached. Keep the billing window open and retry."); }
    if (!response.ok) throw new Error(response.headers.get("cf-mitigated") === "challenge" ? "ChatGPT requires an interactive browser check. Open ChatGPT and retry after completing it." : response.status === 401 ? "Sign in to ChatGPT in this browser again." : response.status === 403 ? "ChatGPT denied access to these details for this login." : `ChatGPT could not return these details (${response.status}).`);
    try { return await response.json(); } catch { throw new Error("ChatGPT returned an unreadable response."); }
  };
  if (!target || typeof target.accountId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(target.accountId) || typeof target.email !== "string") return { error: "The tracked account has no valid provider identity." };
  let session;
  try { session = await request("/api/auth/session"); }
  catch (error) { return { error: error.message }; }
  if (!record(session) || typeof session.accessToken !== "string" || !session.accessToken || !record(session.user) || typeof session.user.email !== "string") return { error: "Sign in to ChatGPT in the billing window, then retry." };
  if (session.user.email.trim().toLowerCase() !== target.email.trim().toLowerCase()) return { mismatch: true };
  const headers = { Authorization: `Bearer ${session.accessToken}`, "ChatGPT-Account-Id": target.accountId };
  const id = encodeURIComponent(target.accountId);
  if (target.workspace) {
    try {
      const accounts = await request("/backend-api/accounts/check/v4-2023-04-27", headers);
      if (!record(accounts) || !record(accounts.accounts) || !Object.hasOwn(accounts.accounts, target.accountId)) return { error: "This login does not report the selected workspace. Switch to an account with access, then retry." };
    } catch (error) { return { error: error.message }; }
  }
  const subscription = target.workspace ? request(`/backend-api/subscriptions?account_id=${id}`, headers) : request("/backend-api/accounts/check/v4-2023-04-27", headers).then((body) => {
    if (!record(body) || !record(body.accounts) || !Object.hasOwn(body.accounts, target.accountId) || !record(body.accounts[target.accountId])) throw new Error("ChatGPT did not return billing for this account. No other account's data was used.");
    return body.accounts[target.accountId];
  });
  // Attach rejection handlers immediately so optional failures cannot reject the whole sync.
  const billing = section(async () => {
    const body = await subscription;
    if (!record(body) || !record(body.entitlement) || typeof body.entitlement.has_active_subscription !== "boolean") throw new Error("ChatGPT's subscription format changed; billing was not updated.");
    const value = body.entitlement;
    const period = value.billing_period ?? body.billing_period;
    return { active: value.has_active_subscription, interval: period === "monthly" ? "monthly" : ["annual", "yearly"].includes(period) ? "annual" : null, currency: currency(value.billing_currency ?? body.billing_currency), renewsAt: date(value.renews_at), expiresAt: date(value.expires_at), willRenew: typeof body.will_renew === "boolean" ? body.will_renew : null };
  });
  const seats = section(async () => {
    const body = await subscription;
    if (!target.workspace) return [];
    if (!record(body) || !Array.isArray(body.seat_capacity)) throw new Error("ChatGPT did not report purchased seat allocations.");
    return body.seat_capacity.map((line) => {
      if (!record(line) || !text(line.type) || count(line.paid) === null) throw new Error("ChatGPT returned an unreadable seat allocation.");
      return { type: line.type, label: seatName(line.type), purchased: line.paid, assigned: record(body.assigned) ? count(body.assigned[line.type]) : null, available: count(line.available) };
    });
  });
  const invoices = section(async () => {
    const body = await request(`/backend-api/payments/transaction-history?account_id=${id}&limit=4`, headers);
    if (!record(body) || !Array.isArray(body.transactions)) throw new Error("ChatGPT's transaction format changed; invoices were not updated.");
    return body.transactions.filter((item) => record(item) && item.type === "invoice").map((item) => {
      if (!text(item.id) || !date(item.created_at) || !Number.isSafeInteger(item.amount) || !currency(item.currency) || !text(item.status)) throw new Error("ChatGPT returned an unreadable invoice.");
      return { id: item.id, createdAt: date(item.created_at), amountMinor: item.amount, currency: currency(item.currency), status: item.status, description: record(item.product) && item.product.is_seat_purchase === true ? "Seat change" : "Subscription" };
    });
  });
  const directory = section(async () => {
    if (!target.workspace) return { total: 0, members: [] };
    let total = null;
    const members = [];
    do {
      const body = await request(`/backend-api/accounts/${id}/users?offset=${members.length}&limit=25&query=`, headers);
      if (!record(body) || !Array.isArray(body.items) || count(body.total) === null || body.total > 1000 || body.offset !== members.length || (total !== null && total !== body.total)) throw new Error("The member list changed or could not be read completely. Retry sync.");
      total = body.total;
      if (!body.items.length && members.length < total) throw new Error("ChatGPT returned an incomplete member list.");
      for (const member of body.items) {
        if (!record(member) || !text(member.id) || !text(member.email) || members.some((item) => item.id === member.id)) throw new Error("ChatGPT returned an unreadable or duplicate member.");
        members.push({ id: member.id, email: member.email, name: text(member.name), role: role(member.role), seat: seatName(member.seat_type) });
      }
      if (members.length > total) throw new Error("ChatGPT returned inconsistent member counts.");
    } while (members.length < total);
    return { total, members };
  });
  const values = await Promise.all([billing, seats, invoices, directory]);
  return { accountId: target.accountId, email: session.user.email, observedAt, billing: values[0], seats: values[1], invoices: values[2], directory: values[3] };
}
