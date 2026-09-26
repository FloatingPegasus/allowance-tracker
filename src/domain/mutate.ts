import type { AppState, Subscription } from "./types";

export function mapSubscription(
  state: AppState,
  id: string,
  update: (subscription: Subscription) => Subscription,
): AppState {
  return {
    ...state,
    subscriptions: state.subscriptions.map((subscription) => (subscription.id === id ? update(subscription) : subscription)),
  };
}
