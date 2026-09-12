/**
 * Applies one checkbox change to a row selection. When `extend` is true and
 * both endpoints are visible, every displayed record between the anchor and
 * target receives the target checkbox's new state. Existing selections outside
 * the range are preserved.
 */
export function updateRowSelection(
  selected: ReadonlySet<string>,
  displayedRecordIds: string[],
  anchorId: string | null,
  targetId: string,
  checked: boolean,
  extend: boolean
): Set<string> {
  const next = new Set(selected)
  const anchorIndex = extend && anchorId ? displayedRecordIds.indexOf(anchorId) : -1
  const targetIndex = displayedRecordIds.indexOf(targetId)
  const ids =
    anchorIndex >= 0 && targetIndex >= 0
      ? displayedRecordIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1
        )
      : [targetId]

  ids.forEach((id) => (checked ? next.add(id) : next.delete(id)))
  return next
}
