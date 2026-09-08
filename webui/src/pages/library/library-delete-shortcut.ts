export function canHandleLibraryDeleteKey(event: KeyboardEvent, previewOpen: boolean) {
  if (
    event.key !== "Delete" || event.repeat || event.defaultPrevented || event.isComposing ||
    event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
  ) return false;

  const target = event.target;
  if (target instanceof HTMLElement && (
    target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='combobox']")
  )) return false;

  return !hasLibraryShortcutOverlay(previewOpen);
}

export function hasLibraryShortcutOverlay(previewOpen = false) {
  // Portal overlays can sit outside the library subtree, including the command palette.
  const overlays = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], ' +
    '[role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
  );
  return Array.from(overlays).some((overlay) =>
    !previewOpen || !overlay.hasAttribute("data-library-media-preview"),
  );
}
