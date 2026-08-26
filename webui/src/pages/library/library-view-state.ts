export type LibraryViewMode = "media" | "details";
export type LibraryDensity = "compact" | "standard" | "comfortable";
export type LibrarySelectionMode = "organize" | "delete";

export type LibraryViewPreferences = {
  viewMode: LibraryViewMode;
  density: LibraryDensity;
};

export const DEFAULT_LIBRARY_VIEW_PREFERENCES: LibraryViewPreferences = {
  viewMode: "media",
  density: "standard",
};

const STORAGE_KEY = "x-media-archiver:library-view-preferences";

export function getLibraryViewPreferences(): LibraryViewPreferences {
  if (typeof window === "undefined") return clonePreferences(DEFAULT_LIBRARY_VIEW_PREFERENCES);

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<LibraryViewPreferences> | null;
    return {
      viewMode: parsed?.viewMode === "details" ? "details" : "media",
      density:
        parsed?.density === "compact" || parsed?.density === "comfortable" ? parsed.density : "standard",
    };
  } catch {
    return clonePreferences(DEFAULT_LIBRARY_VIEW_PREFERENCES);
  }
}

export function saveLibraryViewPreferences(preferences: LibraryViewPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browsing still works when storage is unavailable or full.
  }
}

function clonePreferences(preferences: LibraryViewPreferences): LibraryViewPreferences {
  return { ...preferences };
}
