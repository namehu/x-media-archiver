import type { StateSnapshot } from "react-virtuoso";
import type { FeedFilters } from "./components/feed-filter-panel";
import type { FeedVideoPlaybackState } from "./video-playback-state";

export type FeedBrowseState = {
  filters: FeedFilters;
  submittedFilters: FeedFilters;
  listState: StateSnapshot | null;
  videoPlaybackStates: [string, FeedVideoPlaybackState][];
};

const browseStates = new Map<string, FeedBrowseState>();

export function getFeedBrowseState(locationKey: string) {
  const state = browseStates.get(locationKey);
  if (!state) return undefined;
  return {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    listState: state.listState,
    videoPlaybackStates: cloneVideoPlaybackStates(state.videoPlaybackStates),
  };
}

export function saveFeedBrowseState(locationKey: string, state: FeedBrowseState) {
  browseStates.set(locationKey, {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    listState: state.listState,
    videoPlaybackStates: cloneVideoPlaybackStates(state.videoPlaybackStates),
  });
}

function cloneVideoPlaybackStates(
  states: [string, FeedVideoPlaybackState][],
): [string, FeedVideoPlaybackState][] {
  return states.map(([videoId, playbackState]) => [videoId, { ...playbackState }]);
}
