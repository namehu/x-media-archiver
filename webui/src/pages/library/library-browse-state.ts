import type { GridStateSnapshot } from "react-virtuoso";
import type { LibraryFilters } from "./components/library-filter-panel";
import type { LibraryDensity, LibraryViewMode } from "./library-view-state";

export type LibraryBrowseState = {
  filters: LibraryFilters;
  submittedFilters: LibraryFilters;
  gridStates: Partial<Record<LibraryViewMode, GridStateSnapshot>>;
  scrollTops: Partial<Record<LibraryViewMode, number>>;
  viewMode: LibraryViewMode;
  density: LibraryDensity;
  filtersOpenByView: Record<LibraryViewMode, boolean>;
};

const browseStates = new Map<string, LibraryBrowseState>();

export function getLibraryBrowseState(locationKey: string) {
  const state = browseStates.get(locationKey);
  if (!state) return undefined;
  return {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    gridStates: { ...state.gridStates },
    scrollTops: { ...state.scrollTops },
    viewMode: state.viewMode,
    density: state.density,
    filtersOpenByView: { ...state.filtersOpenByView },
  };
}

export function saveLibraryBrowseState(locationKey: string, state: LibraryBrowseState) {
  browseStates.set(locationKey, {
    filters: { ...state.filters },
    submittedFilters: { ...state.submittedFilters },
    gridStates: { ...state.gridStates },
    scrollTops: { ...state.scrollTops },
    viewMode: state.viewMode,
    density: state.density,
    filtersOpenByView: { ...state.filtersOpenByView },
  });
}
