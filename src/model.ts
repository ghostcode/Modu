import { isFontSizeInRange, storedReadingSizeRange } from "./font-sizes.ts";

export type Source = {
  id: string;
  name: string;
  url: string;
  kind: "demo" | "imported" | "pending";
  archived?: boolean;
  lastError?: string;
  lastSuccess?: string;
  folder?: string;
  folderPath?: string[];
};
export type Article = {
  id: string;
  sourceId: string;
  title: string;
  excerpt: string;
  html: string;
  hasInlineContent?: boolean;
  fullTextHtml?: string;
  date: string;
  url?: string;
  demo?: boolean;
  externalId?: string;
};
export type View = "unread" | "all" | "saved";
export type Locale = "zh-CN" | "en";
export type Preferences = {
  locale?: Locale;
  autoCheckUpdates?: boolean;
  skippedUpdateVersion?: string;
  lastUpdateCheckAt?: string;
  fontSize: number;
  font: "serif" | "sans";
  theme: "paper" | "night";
  accentColor?: string;
  followSystemTheme?: boolean;
  uiFontSize?: number;
  narrowReading?: boolean;
  compactList?: boolean;
  refreshOnLaunch?: boolean;
  refreshInterval?: 0 | 15 | 30 | 60;
  lastFeedRefresh?: { at: string; newCount: number; failed: number };
  feedOrder?: string[];
  sortFeedsByName?: boolean;
  markReadOnOpen?: boolean;
  codeFontFamily?: string;
  singleKeyShortcuts?: boolean;
  uiFontFamily?: string;
  readingFontFamily?: string;
  sidebarWidth?: number;
  articleListWidth?: number;
};
export type Library = {
  version: 1;
  sources: Source[];
  articles: Article[];
  read: string[];
  saved: string[];
  positions: Record<string, number>;
  preferences: Preferences;
  selectedId: string | null;
};

export const storageKey = "shidu.library.v1";

export function httpUrl(input: string, base?: string): string | undefined {
  try {
    const url = new URL(input, base);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

export function filterArticles(
  library: Library,
  view: View,
  sourceId: string | null,
  query: string,
  selectedId: string | null,
  articleText?: (article: Article) => string,
) {
  const search = query.trim().toLocaleLowerCase();
  const sources = new Map(library.sources.map((source) => [source.id, source]));
  const read = new Set(library.read);
  const saved = new Set(library.saved);
  return library.articles.filter((article) => {
    if (sourceId && article.sourceId !== sourceId) return false;
    const source = sources.get(article.sourceId);
    if (view !== "saved" && source?.archived) return false;
    if (view === "saved" && !saved.has(article.id)) return false;
    if (
      view === "unread" &&
      read.has(article.id) &&
      article.id !== selectedId
    )
      return false;
    return (
      !search ||
      `${article.title} ${article.excerpt} ${source?.name ?? ""}`
        .toLocaleLowerCase()
        .includes(search) ||
      (articleText?.(article) ?? "").includes(search)
    );
  });
}

export function mergeImport(
  library: Library,
  sources: Source[],
  articles: Article[],
): Library {
  const nextSources = [...library.sources];
  const sourceIds = new Map<string, string>();
  for (const source of sources) {
    const existing = nextSources.find((item) => item.url === source.url);
    sourceIds.set(source.id, existing?.id ?? source.id);
    if (!existing) nextSources.push(source);
    else if (source.kind === "imported") {
      nextSources[nextSources.indexOf(existing)] = {
        ...existing,
        kind: "imported",
      };
    }
  }
  const nextArticles = [...library.articles];
  for (const article of articles) {
    const sourceId = sourceIds.get(article.sourceId) ?? article.sourceId;
    // Identity is scoped to its feed. Imported source IDs are deterministic.
    const normalized = { ...article, sourceId };
    const index = nextArticles.findIndex(
      (item) => item.id === article.id && item.sourceId === sourceId,
    );
    if (index < 0) nextArticles.push(normalized);
    else nextArticles[index] = {
      ...normalized,
      hasInlineContent: normalized.hasInlineContent ??
        (nextArticles[index].html === normalized.html ? nextArticles[index].hasInlineContent : undefined),
      fullTextHtml: normalized.fullTextHtml ??
        (nextArticles[index].url === normalized.url ? nextArticles[index].fullTextHtml : undefined),
    };
  }
  return { ...library, sources: nextSources, articles: nextArticles };
}

export function isLibrary(value: unknown): value is Library {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Library>;
  return (
    data.version === 1 &&
    Array.isArray(data.sources) &&
    data.sources.every(
      (source) =>
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.url === "string" &&
        (source.folderPath === undefined ||
          (Array.isArray(source.folderPath) && source.folderPath.length <= 32 &&
            source.folderPath.every((part) => typeof part === "string"))) &&
        ["demo", "imported", "pending"].includes(source.kind),
    ) &&
    Array.isArray(data.articles) &&
    data.articles.every(
      (article) =>
        typeof article.id === "string" &&
        typeof article.sourceId === "string" &&
        typeof article.title === "string" &&
        typeof article.html === "string" &&
        (article.hasInlineContent === undefined || typeof article.hasInlineContent === "boolean") &&
        (article.fullTextHtml === undefined || typeof article.fullTextHtml === "string") &&
        typeof article.excerpt === "string" &&
        typeof article.date === "string" &&
        (article.date === "" || Number.isFinite(Date.parse(article.date))) &&
        (article.url === undefined ||
          (typeof article.url === "string" && !!httpUrl(article.url))),
    ) &&
    Array.isArray(data.read) &&
    data.read.every((id) => typeof id === "string") &&
    Array.isArray(data.saved) &&
    data.saved.every((id) => typeof id === "string") &&
    !!data.positions &&
    typeof data.positions === "object" &&
    Object.values(data.positions).every(
      (position) =>
        typeof position === "number" &&
        Number.isFinite(position) &&
        position >= 0,
    ) &&
    !!data.preferences &&
    isFontSizeInRange(data.preferences.fontSize, storedReadingSizeRange) &&
    ["serif", "sans"].includes(data.preferences.font) &&
    ["paper", "night"].includes(data.preferences.theme) &&
    (data.selectedId === null || typeof data.selectedId === "string")
  );
}
