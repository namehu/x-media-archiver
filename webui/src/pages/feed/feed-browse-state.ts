import type { StateSnapshot } from "react-virtuoso";
import type { FeedFilters } from "./components/feed-filter-panel";

export type FeedBrowseState = {
  filters: FeedFilters;
  submittedFilters: FeedFilters;
  listState: StateSnapshot | null;
};

const browseStates = new Map<string, FeedBrowseState>();

export function getFeedBrowseState(locationKey: string) {
  const state = browseStates.get(locationKey);
  if (!state) return undefined;
  return {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    listState: state.listState,
  };
}

export function saveFeedBrowseState(locationKey: string, state: FeedBrowseState) {
  browseStates.set(locationKey, {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    listState: state.listState,
  });
}
