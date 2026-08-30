import { useState, useEffect, useRef, useCallback } from "react";

interface UseInfiniteScrollOptions {
  /** Initial number of items to show */
  initialCount?: number;
  /** How many items to load per batch */
  batchSize?: number;
  /** Simulated loading delay in ms */
  loadDelay?: number;
  /** Pixel distance from bottom to trigger loading */
  threshold?: number;
}

export function useInfiniteScroll<T>(
  allItems: T[],
  generateMore: (existingCount: number) => T[],
  options: UseInfiniteScrollOptions = {}
) {
  const {
    initialCount = 12,
    batchSize = 8,
    loadDelay = 600,
    threshold = 80,
  } = options;

  const [items, setItems] = useState<T[]>(() => allItems.slice(0, initialCount));
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Sync if allItems identity changes (for filtered/sorted lists)
  const prevAllRef = useRef(allItems);
  useEffect(() => {
    if (prevAllRef.current !== allItems) {
      prevAllRef.current = allItems;
      setItems(allItems.slice(0, initialCount));
    }
  }, [allItems, initialCount]);

  const loadMore = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);

    setTimeout(() => {
      setItems((prev) => {
        const newBatch = generateMore(prev.length);
        return [...prev, ...newBatch.slice(0, batchSize)];
      });
      setIsLoading(false);
      loadingRef.current = false;
    }, loadDelay);
  }, [generateMore, batchSize, loadDelay]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loadingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < threshold) {
      loadMore();
    }
  }, [loadMore, threshold]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  return { items, isLoading, scrollRef };
}
