export type FeedVideoPlaybackState = {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  playbackRate: number;
  volume: number;
  muted: boolean;
  duration: number | null;
  updatedAt: number;
};

export type FeedVideoPlaybackSnapshot = Partial<Omit<FeedVideoPlaybackState, "updatedAt">>;

export type FeedVideoPlaybackStateApi = {
  getVideoState: (videoId: string) => FeedVideoPlaybackState | undefined;
  updateVideoState: (videoId: string, snapshot: FeedVideoPlaybackSnapshot) => FeedVideoPlaybackState;
};

export function videoPlaybackStateFromElement(video: HTMLVideoElement): FeedVideoPlaybackSnapshot {
  return {
    currentTime: finiteOrZero(video.currentTime),
    paused: video.paused,
    ended: video.ended,
    playbackRate: finiteOrDefault(video.playbackRate, 1),
    volume: finiteOrDefault(video.volume, 1),
    muted: video.muted,
    duration: Number.isFinite(video.duration) ? video.duration : null,
  };
}

export function clampPlaybackTime(currentTime: number, duration?: number | null) {
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  if (!duration || !Number.isFinite(duration) || duration <= 0) return currentTime;
  if (currentTime >= duration) return Math.max(0, duration - 0.25);
  return currentTime;
}

export function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function remainingPlaybackSeconds(duration: number | null | undefined, currentTime: number) {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.ceil(duration - finiteOrZero(currentTime)));
}

export function formatPlaybackClock(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clockParts = [minutes, seconds].map((part) => part.toString().padStart(2, "0"));
  return hours > 0 ? [hours.toString(), ...clockParts].join(":") : clockParts.join(":");
}

export function formatPlaybackCountdown(value: number) {
  return formatPlaybackClock(value);
}

function finiteOrDefault(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}
