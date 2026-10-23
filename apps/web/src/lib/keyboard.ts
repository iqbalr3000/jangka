export const modKeyLabel = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl ";

/** Shortcuts like ⌘B must not steal keys from inputs or the editor (bold). */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
