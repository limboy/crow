import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { AudioRepeatMode, AudioShuffleMode } from '@shared/types'
import { cn } from '@/lib/utils'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * A player's place in a table column's playlist. The column is addressed by
 * position rather than by element: the table only mounts the rows it is
 * showing, so most of the playlist has no DOM at any given moment. Handing the
 * next position back through `requestPlay` lets the view scroll it into the
 * window and start it there.
 */
export interface AudioPlayback {
  groupId: string
  /** 0-based position among the column's playable cells, in display order. */
  order: number
  /** How many playable cells the column has, mounted or not. */
  total: number
  autoPlayNext: boolean
  repeatMode: AudioRepeatMode
  shuffleMode: AudioShuffleMode
  /** Asks the view to show `order`'s row and start its player. */
  requestPlay: (order: number) => void
  /** Set by the view on the player it was just asked to start, and bumped on
   *  every request so the same cell can be started twice in a row. */
  autoPlayToken?: number
}

interface PlaylistState {
  /** Positions still to come in the current shuffled pass. */
  shuffleRemaining: number[]
  /** Position this playlist just asked to be played, so the play it triggers
   *  is recognised as a continuation rather than a fresh session. */
  next?: number
  shuffleMode?: AudioShuffleMode
}

// Players remain separate controls, but a table column can opt them into one
// ordered playlist. Module scope also keeps the existing one-audible-clip
// invariant across standalone players, cards, editors, and table playlists.
let currentlyPlaying: HTMLAudioElement | null = null
const playlists = new Map<string, PlaylistState>()

function playlistState(groupId: string): PlaylistState {
  let state = playlists.get(groupId)
  if (!state) {
    state = { shuffleRemaining: [] }
    playlists.set(groupId, state)
  }
  return state
}

function shuffled(items: number[]): number[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Every position in the playlist but the one playing, which is where a
 *  shuffled pass starts from. */
function othersShuffled(playback: AudioPlayback): number[] {
  const others: number[] = []
  for (let i = 0; i < playback.total; i += 1) if (i !== playback.order) others.push(i)
  return shuffled(others)
}

function playFromStart(audio: HTMLAudioElement): void {
  audio.currentTime = 0
  void audio.play().catch(() => undefined)
}

function beginPlaylistSession(playback: AudioPlayback): void {
  if (!playback.autoPlayNext) {
    playlists.delete(playback.groupId)
    return
  }
  const state = playlistState(playback.groupId)
  if (state.next === playback.order) {
    state.next = undefined
    return
  }
  state.shuffleMode = playback.shuffleMode
  state.shuffleRemaining = othersShuffled(playback)
}

function advancePlaylist(audio: HTMLAudioElement, playback: AudioPlayback): void {
  if (!playback.autoPlayNext) {
    playlists.delete(playback.groupId)
    return
  }
  const state = playlistState(playback.groupId)

  if (playback.repeatMode === 'one') {
    state.next = playback.order
    playFromStart(audio)
    return
  }

  let next: number | undefined
  if (playback.shuffleMode === 'on') {
    if (state.shuffleMode !== 'on') {
      state.shuffleMode = 'on'
      state.shuffleRemaining = othersShuffled(playback)
    }
    // Rows can come and go between clips (a filter, an edit), so drop
    // positions the column no longer has.
    state.shuffleRemaining = state.shuffleRemaining.filter(
      (candidate) => candidate !== playback.order && candidate < playback.total
    )
    next = state.shuffleRemaining.shift()
    if (next === undefined && playback.repeatMode === 'all') {
      state.shuffleRemaining = othersShuffled(playback)
      next = state.shuffleRemaining.shift() ?? playback.order
    }
  } else {
    state.shuffleMode = 'off'
    const following = playback.order + 1
    next =
      following < playback.total ? following : playback.repeatMode === 'all' ? 0 : undefined
  }

  if (next === undefined) return
  state.next = next
  // A one-clip column repeating itself is the only case that stays put.
  if (next === playback.order) playFromStart(audio)
  else playback.requestPlay(next)
}

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
export function AudioPlayer({
  src,
  className,
  playback
}: {
  src: string
  className?: string
  playback?: AudioPlayback
}): React.JSX.Element {
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
  // The view asked for this cell: start it, whether it was already on screen
  // or has just been scrolled into the window for this very purpose.
  const autoPlayToken = playback?.autoPlayToken
  useEffect(() => {
    if (autoPlayToken === undefined) return
    const audio = audioRef.current
    if (audio) playFromStart(audio)
  }, [autoPlayToken])

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
          if (playback) beginPlaylistSession(playback)
          setPlaying(true)
        }}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false)
          if (playback) advancePlaylist(e.currentTarget, playback)
        }}
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
