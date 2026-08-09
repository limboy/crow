import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Every <AudioPlayer> instance is independent (own <audio> element, own
// state), but only one clip should ever be audible at a time. Track the
// single currently-playing element at module scope so starting one player
// can reach across and pause whichever other one is running.
let currentlyPlaying: HTMLAudioElement | null = null

function pauseOthers(el: HTMLAudioElement): void {
  if (currentlyPlaying && currentlyPlaying !== el) {
    currentlyPlaying.pause()
  }
  currentlyPlaying = el
}

/**
 * Minimal play/pause + seek bar + time. Stands in for the browser's native
 * `<audio controls>`, which also ships a volume slider and an overflow menu
 * (playback speed, download, loop) we don't want here.
 */
export function AudioPlayer({ src, className }: { src: string; className?: string }): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)

  // A new src is a different clip; drop the stale progress from the last one.
  useEffect(() => {
    setPlaying(false)
    setDuration(0)
    setCurrent(0)
  }, [src])

  // Don't leave a dangling reference behind when this player unmounts (e.g.
  // the record it belongs to scrolls out of a virtualized list) while it was
  // the one "currently playing" — otherwise the next player's first play
  // would try to pause an element that's already gone.
  useEffect(() => {
    return () => {
      if (currentlyPlaying === audioRef.current) currentlyPlaying = null
    }
  }, [])

  const togglePlay = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      // A previous play() may have been interrupted (e.g. by another
      // player's pause(), or a transient load failure) and left the element
      // stuck rejecting further play() calls. Reloading the source resets
      // it so playback can actually resume instead of silently no-op'ing.
      if (audio.error || audio.networkState === audio.NETWORK_NO_SOURCE) {
        audio.load()
      }
      audio.play().catch(() => {
        // play() was rejected (e.g. AbortError from a rapid pause, or a
        // genuine load failure) — reflect that we're not playing instead of
        // leaving the button stuck showing "playing".
        setPlaying(false)
      })
    } else {
      audio.pause()
    }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>): void => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
    setCurrent(ratio * duration)
  }

  const progress = duration > 0 ? current / duration : 0

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border bg-muted/40 py-1 pl-1 pr-3',
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={(e) => {
          pauseOthers(e.currentTarget)
          setPlaying(true)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        onStalled={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
      />
      <button
        type="button"
        onClick={togglePlay}
        className="mr-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:opacity-85"
      >
        {playing ? (
          <Pause className="size-3" fill="currentColor" />
        ) : (
          <Play className="size-3 translate-x-px" fill="currentColor" />
        )}
      </button>
      <div className="relative h-1 min-w-10 flex-1 rounded-full bg-foreground/15" onClick={seek}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/60"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatTime(Math.max(0, duration - current))}
      </span>
    </div>
  )
}
