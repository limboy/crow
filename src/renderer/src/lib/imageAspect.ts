import { RectangleHorizontal, RectangleVertical, Square, type LucideIcon } from 'lucide-react'
import type { ImageAspectRatio } from '@shared/types'

export interface ImageAspectRatioInfo {
  value: ImageAspectRatio
  label: string
  icon: LucideIcon
  /** Tailwind class giving an element this ratio's box shape. */
  className: string
}

export const IMAGE_ASPECT_RATIO_OPTIONS: ImageAspectRatioInfo[] = [
  { value: '3:5', label: 'Portrait (3:5)', icon: RectangleVertical, className: 'aspect-[3/5]' },
  { value: '1:1', label: 'Square (1:1)', icon: Square, className: 'aspect-square' },
  { value: '5:3', label: 'Landscape (5:3)', icon: RectangleHorizontal, className: 'aspect-[5/3]' }
]

const DEFAULT_ASPECT_RATIO: ImageAspectRatio = '5:3'

export function imageAspectRatioInfo(ratio: ImageAspectRatio | undefined): ImageAspectRatioInfo {
  return (
    IMAGE_ASPECT_RATIO_OPTIONS.find((option) => option.value === ratio) ??
    IMAGE_ASPECT_RATIO_OPTIONS.find((option) => option.value === DEFAULT_ASPECT_RATIO)!
  )
}
