import type { Category } from "../components/reports/CategoryManagerModal";
import { invokeCommand, invokeWithFallback } from "./tauri";

export type SunburstPersistedSettings = {
  categories: Category[];
  assignments: Record<string, string>;
};

function isCategory(value: unknown): value is Category {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Category>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.color === "string" &&
    (candidate.isDefault === undefined ||
      typeof candidate.isDefault === "boolean")
  );
}

export async function loadSunburstSettings(): Promise<SunburstPersistedSettings | null> {
  const raw = await invokeWithFallback<string>("get_sunburst_settings", () => "");
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const candidate = parsed as {
        categories?: unknown;
        assignments?: unknown;
      };

      if (
        Array.isArray(candidate.categories) &&
        candidate.categories.every(isCategory) &&
        typeof candidate.assignments === "object" &&
        candidate.assignments !== null &&
        !Array.isArray(candidate.assignments)
      ) {
        const assignments = Object.fromEntries(
          Object.entries(candidate.assignments).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );

        return {
          categories: candidate.categories.map((category) => ({ ...category })),
          assignments,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveSunburstSettings(
  data: SunburstPersistedSettings,
): Promise<void> {
  await invokeCommand<void>("save_sunburst_settings", {
    json: JSON.stringify(data),
  });
}
