import { Check, Paperclip, Play, Video } from 'lucide-react'
import type { Field } from '@shared/types'
import {
  attachmentsFrom,
  choiceById,
  choicesByIds,
  displayValue,
  isEmptyValue,
  linkedRecords,
  recordLabel,
  relationTable,
  videoFrom,
  videoLabel
} from '@/lib/fields'
import { useProjectTables } from '@/lib/relations'
import { cn } from '@/lib/utils'
import { AudioPlayer, type AudioPlayback } from './AudioPlayer'
import { ChoiceBadge } from './ChoiceBadge'
import { RatingStars } from './RatingStars'
import { RecordBadge } from './RecordBadge'

/** Read-only rendering of a record value, shared by table cells and cards. */
export function ValueDisplay({
  field,
  value,
  className,
  lineClamp = 1,
  audioPlayback
}: {
  field: Field
  value: unknown
  className?: string
  /** Number of text lines to wrap to before truncating; 1 keeps the classic single-line clip. */
  lineClamp?: number
  /** Optional table-column playlist behavior; cards and editors remain standalone. */
  audioPlayback?: AudioPlayback
}): React.JSX.Element | null {
  // Only relation cells read this, but the hook has to run unconditionally.
  const tables = useProjectTables()
  if (isEmptyValue(field, value)) return null

  // Tailwind needs literal class names to see at build time, so map rather than interpolate.
  const clampClass =
    { 2: 'line-clamp-2', 4: 'line-clamp-4', 9: 'line-clamp-9' }[lineClamp] ??
    (lineClamp > 1 ? 'line-clamp-6' : null)
  const wrapClass = clampClass ? cn(clampClass, 'whitespace-pre-wrap break-words') : 'truncate'

  switch (field.type) {
    case 'select': {
      const choice = choiceById(field, value)
      return choice ? <ChoiceBadge choice={choice} className={className} /> : null
    }
    case 'multiSelect':
      return (
        <span className={cn('flex flex-wrap items-center gap-1', className)}>
          {choicesByIds(field, value).map((choice) => (
            <ChoiceBadge key={choice.id} choice={choice} />
          ))}
        </span>
      )
    case 'relation': {
      const target = relationTable(field, tables)
      if (!target) return null
      return (
        <span className={cn('flex flex-wrap items-center gap-x-1 gap-y-1.5', className)}>
          {linkedRecords(field, value, tables).map((record) => (
            <RecordBadge key={record.id} label={recordLabel(target, record)} />
          ))}
        </span>
      )
    }
    case 'checkbox':
      return (
        <span
          className={cn(
            'inline-flex size-4 items-center justify-center rounded-[4px] bg-primary text-primary-foreground',
            className
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )
    case 'url':
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            wrapClass,
            'text-blue-600 underline-offset-2 hover:underline dark:text-blue-400',
            className
          )}
        >
          {String(value)}
        </a>
      )
    case 'image': {
      // `max-h-full` can't resolve inside a table cell (no definite containing-block
      // height in standard table layout), so the thumbnail would render at its
      // intrinsic size and blow up the row. Cap it to a fixed height per row-height
      // tier instead, sized to fit within that row after its padding/border.
      const imageMaxHeightClass = { 2: 'max-h-12', 4: 'max-h-24', 9: 'max-h-48' }[lineClamp] ?? 'max-h-32'
      return (
        <img
          src={String(value)}
          alt=""
          className={cn(
            'rounded-sm border',
            lineClamp > 1
              ? cn(imageMaxHeightClass, 'max-w-full object-contain')
              : 'h-6 w-10 object-cover',
            className
          )}
        />
      )
    }
    case 'video': {
      const video = videoFrom(value)
      if (!video) return null
      // The poster is the only part rendered inline; clicking hands the video
      // itself to the OS player, the way an attachment is opened.
      const posterMaxHeightClass =
        { 2: 'max-h-12', 4: 'max-h-24', 9: 'max-h-48' }[lineClamp] ?? 'max-h-32'
      return (
        <button
          type="button"
          title={`Play ${videoLabel(video)}`}
          onClick={(e) => {
            e.stopPropagation()
            void window.api.openVideo(video.url)
          }}
          className={cn('relative inline-flex max-w-full items-center', className)}
        >
          {video.poster ? (
            <>
              <img
                src={video.poster}
                alt=""
                className={cn(
                  'rounded-sm border',
                  lineClamp > 1
                    ? cn(posterMaxHeightClass, 'max-w-full object-contain')
                    : 'h-6 w-10 object-cover'
                )}
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full bg-black/55 text-white',
                    lineClamp > 1 ? 'size-7' : 'size-4'
                  )}
                >
                  <Play className={cn('fill-current', lineClamp > 1 ? 'size-3' : 'size-2')} />
                </span>
              </span>
            </>
          ) : (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-300">
              <Video className="size-3 shrink-0" />
              <span className="truncate">{videoLabel(video)}</span>
            </span>
          )}
        </button>
      )
    }
    case 'audio':
      return (
        <AudioPlayer
          src={String(value)}
          className={cn('max-w-56', className)}
          playback={audioPlayback}
        />
      )
    case 'rating':
      return <RatingStars value={value as number} className={className} />
    case 'attachment':
      return (
        <span className={cn('flex flex-wrap items-center gap-1', className)}>
          {attachmentsFrom(value).map((file, i) => (
            <button
              key={`${file.url}-${i}`}
              type="button"
              // Opened through the main process rather than linked to: a
              // navigation to an `app-attachment:` url would run the preload
              // against the file's own contents.
              onClick={(e) => {
                e.stopPropagation()
                void window.api.openAttachment(file.url)
              }}
              title={file.name}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 hover:underline dark:bg-neutral-800 dark:text-neutral-300"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{file.name}</span>
            </button>
          ))}
        </span>
      )
    default:
      return <span className={cn(wrapClass, className)}>{displayValue(field, value, tables)}</span>
  }
}
