/**
 * Standard ceiling for input-intensity scoring on the timeline heatmap
 * (volume × quality). Density charts use 0–100% instead.
 */
export const STANDARD_APM_MAX = 250;

/** Zone thresholds on the same 0–STANDARD_APM_MAX scale (stricter than legacy 65/50/35 on 0–100). */
export const APM_ZONE_PEAK_MIN = 163;
export const APM_ZONE_GOOD_MIN = 125;
export const APM_ZONE_NORMAL_MIN = 88;
