// Download-then-play cache (V2): video playback in the iPad app's
// WebView starved when the media stack had to feed itself through
// streamed range requests against the canvas blob endpoint — the
// file itself is small and trivially hardware-decodable, but the
// in-app container could not keep the stream fed, so playback
// stuttered. The fix is to take streaming out of playback entirely:
// on the user's play tap, fetch the WHOLE file once, turn it into a
// local blob: object URL, and hand THAT to the <video>. Playback is
// then purely local and no range request is ever made.
//
// One cache, keyed by the remote URL, shared by every playback
// surface (node cards and the preview dialog): a video downloaded
// in a node plays instantly in the dialog and vice versa. The cache
// stores the in-flight PROMISE, so concurrent requests for the same
// URL share a single download instead of racing two fetches.
//
// Failures are NOT cached: a rejected entry evicts itself so the
// next play tap retries the download (callers fall back to the
// remote URL for that one attempt, so a failed fetch never leaves
// playback worse than plain streaming).

const cache = new Map<string, Promise<string>>();

/**
 * Resolve a remote media URL to a local blob: object URL, downloading
 * the whole file on first use. Rejects when the fetch fails; the
 * caller is expected to fall back to the remote URL in that case.
 */
export function getLocalPlaybackUrl(remoteUrl: string): Promise<string> {
  const existing = cache.get(remoteUrl);
  if (existing) return existing;
  const pending = (async () => {
    const res = await fetch(remoteUrl);
    if (!res.ok) {
      throw new Error(`playback download failed: HTTP ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  })();
  cache.set(remoteUrl, pending);
  pending.catch(() => {
    if (cache.get(remoteUrl) === pending) cache.delete(remoteUrl);
  });
  return pending;
}

/**
 * Drop every cached object URL (revoking each one). Called when the
 * project switches: the old project's cards unmount with it, so no
 * live <video> still points at the revoked URLs, and the next
 * project's videos download fresh on their first play tap.
 */
export function releasePlaybackBlobs(): void {
  const pending = [...cache.values()];
  cache.clear();
  for (const p of pending) {
    void p
      .then((url) => URL.revokeObjectURL(url))
      .catch(() => undefined);
  }
}
