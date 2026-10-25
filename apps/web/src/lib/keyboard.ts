export const modKeyLabel = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl ";

/** Shortcuts like ⌘B must not steal keys from inputs or the editor (bold). */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Single-key shortcuts (`N`, `[`): no modifiers, not while typing or inside an open dialog. */
export function isPlainKey(event: KeyboardEvent, key: string): boolean {
  return (
    event.key === key &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditableTarget(event.target) &&
    document.querySelector('[role="dialog"]') === null
  );
}
