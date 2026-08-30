import { useEffect, useRef, useState } from "react";

import {
  getLiveWorkQualitySnapshot,
  getQualityDaySnapshot,
  isQualityDayReady,
  startQualityLiveStore,
  subscribeQualityLive,
} from "../qualityLiveStore";

export function useLiveWorkQuality() {
  const [live, setLive] = useState(getLiveWorkQualitySnapshot);

  useEffect(() => {
    startQualityLiveStore();
    return subscribeQualityLive(setLive);
  }, []);

  return live;
}

/** Sidecar day buffer. Updates on hydrate and once per minute — not every 1s tick. */
export function useQualityDay() {
  const [day, setDay] = useState(() =>
    isQualityDayReady() ? Uint8Array.from(getQualityDaySnapshot()) : undefined,
  );
  const lastMinuteRef = useRef(-1);

  useEffect(() => {
    startQualityLiveStore();
    return subscribeQualityLive((live) => {
      if (!isQualityDayReady()) {
        lastMinuteRef.current = -1;
        setDay(undefined);
        return;
      }
      const minute = Math.floor(live.secondOfDay / 60);
      if (minute === lastMinuteRef.current) {
        return;
      }
      lastMinuteRef.current = minute;
      setDay(Uint8Array.from(getQualityDaySnapshot()));
    });
  }, []);

  return day;
}
