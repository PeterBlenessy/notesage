import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How far outside the viewport a row or card counts as "about to be seen".
 *
 * One viewport in each direction, which for the gallery is roughly a screen
 * of cards and for the list roughly a screen of rows. The point is to have
 * the thumbnail ALREADY IN FLIGHT by the time something scrolls into view,
 * rather than starting the work at the moment it is wanted — which is why
 * thumbnails arrived visibly after the list they belong to.
 *
 * A screen ahead rather than several: the generator runs at a concurrency of
 * two on purpose (`mobile-thumbnails.ts`), so a deeper lead does not make
 * anything arrive sooner, it only makes the queue longer and fills it with
 * cards the user may never reach.
 */
const LEAD = "100% 0px";

/**
 * Has this element been seen, or is it about to be?
 *
 * Latches: once true it stays true and the observer disconnects. A thumbnail
 * that has been fetched is cached anyway, so there is nothing to reclaim by
 * watching an element leave, and a latch means scrolling back up never
 * re-queues work.
 *
 * # Why the list needs this as much as the gallery
 *
 * The gallery has always gated on visibility; the list rows did not — every
 * row asked for its thumbnail the moment it mounted. With a concurrency of
 * two that is not a burst, but it IS an ordering problem: in a folder of five
 * hundred files, a row twenty screens down sits behind four hundred and
 * eighty jobs for rows nobody is looking at. Gating both surfaces on the same
 * predicate makes the queue follow the user instead of the DOM.
 *
 * Returns a callback ref rather than taking a `RefObject`, so it works for a
 * caller that has no ref of its own and cannot know when its node mounts.
 */
export function useVisibleSoon<T extends Element>(
  enabled = true,
): [(node: T | null) => void, boolean] {
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Disconnect on unmount; the callback ref below owns connect/disconnect for
  // the rest of the lifetime.
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !enabled || visible) return;
      // Feature-detect: a real WKWebView always has IntersectionObserver. The
      // fallback — treat it as visible at once — keeps jsdom and any engine
      // without it showing thumbnails rather than none.
      if (typeof IntersectionObserver === "undefined") {
        setVisible(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          observerRef.current = null;
          setVisible(true);
        },
        { rootMargin: LEAD },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [enabled, visible],
  );

  return [ref, visible];
}
