// Single-playback registry (V1): at most one <video> on the whole
// canvas plays at a time. Every playing surface (node cards and the
// shared preview dialog) reports its play/pause here; when a video
// starts, every other registered video is paused. In the iPad app's
// WebView, concurrent decoders compete for a much smaller media
// budget than in a full browser, so serializing playback is part of
// keeping playback smooth. Module scope on purpose — no state
// library, no React state: the elements themselves are the truth.

const playingVideos = new Set<HTMLVideoElement>();

/** Call from a <video>'s onPlay: pauses every other live video. */
export function noteVideoPlay(video: HTMLVideoElement): void {
  for (const other of playingVideos) {
    if (other !== video && !other.paused) {
      other.pause();
    }
  }
  playingVideos.add(video);
}

/** Call from a <video>'s onPause / onEnded: drops it from the set. */
export function noteVideoStop(video: HTMLVideoElement): void {
  playingVideos.delete(video);
}
