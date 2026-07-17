import type { GridStateSnapshot } from "react-virtuoso";
import type { LibraryFilters } from "./components/library-filter-panel";

export type LibraryBrowseState = {
  filters: LibraryFilters;
  submittedFilters: LibraryFilters;
  gridState: GridStateSnapshot | null;
};

const browseStates = new Map<string, LibraryBrowseState>();

export function getLibraryBrowseState(locationKey: string) {
  const state = browseStates.get(locationKey);
  if (!state) return undefined;
  return {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    gridState: state.gridState,
  };
}

export function saveLibraryBrowseState(locationKey: string, state: LibraryBrowseState) {
  browseStates.set(locationKey, {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    gridState: state.gridState,
  });
}
