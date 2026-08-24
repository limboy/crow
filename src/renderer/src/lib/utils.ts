import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True while focus is somewhere the browser has its own editing behaviour —
 *  a cell being typed into, a rename field — where ⌘Z, ⌘C and ⌘V belong to the
 *  text, not to the grid or the project's edit history. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio'].includes(target.type)
}
