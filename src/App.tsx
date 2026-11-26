import { LocaleContext } from "./locale-context";
import { translate } from "./locale";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  BookmarkSimpleIcon,
  BookOpenIcon,
  CaretDownIcon,
  CircleIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  GearSixIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  RssIcon,
  SidebarSimpleIcon,
  StackIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createLibrary, extraArticle, extraSource } from "./data";
import { createArticleDateFormatter } from "./article-date";
import { cachedArticleText, downloadFile, exportOpml, parseFeedFile } from "./feed-import";
import {
  filterArticles,
  httpUrl,
  isLibrary,
  mergeImport,
  storageKey,
  type Library,
  type Preferences,
  type Source,
  type View,
} from "./model";
import { useUpdateCenter } from "./UpdateCenter";
import { SettingsDialog, type SettingsSection } from "./SettingsDialog";
import { Reader } from "./Reader";
import { StartupScreen } from "./StartupScreen";
import { discardImportedUpdates, queueUpdates } from "./feed-updates";
import { CloseRecoveryDialog } from "./CloseRecoveryDialog";
import { SubscriptionDialog, type Submission } from "./SubscriptionDialog";
import { SubscriptionList } from "./SubscriptionList";
import { SourceEditDialog } from "./SourceEditDialog";
import {
  canReorderSource,
  orderSources,
  reorderedSourceIds,
} from "./source-layout";
import {
  desktop,
  native,
  persistence,
  installExitHandler,
  interceptExternalLinks,
  listenNativeMenus,
  type Loaded,
  type Changes,
} from "./desktop";
import {
  applyAppearance,
  effectiveAppearance,
  normalizePreferences,
} from "./appearance";
import { fontSizes } from "./font-sizes";

function loadLibrary(): { library: Library; error: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { library: createLibrary(), error: "" };
    const value: unknown = JSON.parse(raw);
    if (isLibrary(value))
      return {
        library: {
          ...value,
          preferences: normalizePreferences(value.preferences),
        },
        error: "",
      };
    return {
      library: createLibrary(),
      error: "原有阅读库格式异常，已保留原数据。本次操作暂不保存。",
    };
  } catch {
    return {
      library: createLibrary(),
      error: "无法读取本地阅读库。本次操作暂不保存。",
    };
  }
}

const viewLabels: Record<View, string> = {
  unread: "未读",
  all: "全部文章",
  saved: "收藏",
};
const navigation = [
  ["unread", ListBulletsIcon],
  ["all", StackIcon],
  ["saved", BookmarkSimpleIcon],
] as const;

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (desktop)
      void native
        .load()
        .then(setLoaded)
        .catch((reason) => setError(String(reason)));
    document.addEventListener("click", interceptExternalLinks, true);
    return () =>
      document.removeEventListener("click", interceptExternalLinks, true);
  }, []);
  const content = desktop && !loaded
    ? (
      <LocaleContext.Provider value={document.documentElement.lang === "en" ? "en" : "zh-CN"}>
        <StartupScreen error={error} onLoaded={setLoaded} />
      </LocaleContext.Provider>
    )
    : <ReaderApp loaded={loaded} />;
  if (!desktop || !navigator.platform.startsWith("Mac")) return content;
  return (
    <div className="desktop-frame">
      <div className="native-titlebar" data-tauri-drag-region aria-hidden="true" />
      {content}
    </div>
  );
}

function ReaderApp({ loaded }: { loaded: Loaded | null }) {
  const [initial] = useState(() =>
    loaded
      ? {
          library: {
            ...loaded.library,
            preferences: normalizePreferences(loaded.library.preferences),
          },
          error: "",
        }
      : loadLibrary(),
  );
  const [library, setLibrary] = useState(initial.library);
  const locale = library.preferences.locale ?? "zh-CN";
  const t = translate[locale];
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("墨牍");
    if (desktop) void native.setLocale(locale).catch(console.error);
  }, [locale, t]);
  const [storageError, setStorageError] = useState(initial.error);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection | null>(null);
  const settingsOrigin = useRef<HTMLElement | null>(null);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const effectiveTheme = effectiveAppearance(library.preferences, systemDark);
  const patchPreferences = (patch: Partial<Preferences>) => {
    setLibrary((current) => ({
      ...current,
      preferences: { ...current.preferences, ...patch },
    }));
  };
  const openSettings = useCallback(
    (section: SettingsSection = "appearance", trigger?: HTMLElement) => {
      const origin = trigger ?? document.activeElement;
      if (!origin?.closest(".settings-dialog")) {
        settingsOrigin.current = origin instanceof HTMLElement ? origin : null;
      }
      setNavOpen(false);
      setSettingsSection(section);
    },
    [],
  );
  const [closeError, setCloseError] = useState("");
  const restorePending = useRef(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const refreshPending = useRef(false);
  const refreshAbort = useRef<AbortController | null>(null);
  const [newVersion, setNewVersion] = useState("");
  const [installLocked, setInstallLocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updates, setUpdates] = useState<Changes[]>([]);
  const operation = useRef(0);
  const [nativeSave] = useState(() =>
    loaded ? persistence(loaded.revision, setStorageError) : null,
  );
  const [view, setView] = useState<View>("unread");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchEverywhere, setSearchEverywhere] = useState(false);
  const [batchUndo, setBatchUndo] = useState<string[]>([]);
  const [sourceToEdit, setSourceToEdit] = useState<Source | null>(null);
  const [fetchingFullText, setFetchingFullText] = useState<Set<string>>(new Set());
  const restoredGeneration = useRef(0);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const selectedArticleRow = useRef<HTMLButtonElement>(null);
  const keyboardArticle = useRef<{ id: string; moveFocus: boolean } | null>(null);
  const [focus, setFocus] = useState(false);
  const [mobileReader, setMobileReader] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [archivedNotice, setArchivedNotice] = useState<Source | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const sourceMutation = useRef(false);
  const sourceMenuTrigger = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusUndo = useRef(false);
  const [restore, setRestore] = useState<Library | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const libraryRef = useRef(library);
  const positions = useRef(library.positions);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  libraryRef.current = library;

  const persist = useCallback(
    (snapshot: Library) => {
      if (initial.error) return;
      if (nativeSave) {
        nativeSave.enqueue({
          ...snapshot,
          positions: { ...positions.current },
        });
        return;
      }
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...snapshot, positions: positions.current }),
        );
        setStorageError("");
      } catch {
        setStorageError(t("本地空间不足或不可用，最近改动尚未保存。请导出备份。"));
      }
    },
    [initial.error, nativeSave],
  );
  useEffect(() => {
    persist(library);
  }, [library, persist]);
  useEffect(() => {
    const save = () => persist(libraryRef.current);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      clearTimeout(saveTimer.current);
      clearTimeout(noticeTimer.current);
    };
  }, [persist]);
  const flushReadingState = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!nativeSave) throw Error(t("阅读库尚未就绪。"));
    nativeSave.enqueue({
      ...libraryRef.current,
      positions: { ...positions.current },
    });
    await nativeSave.flush();
    return nativeSave.getRevision();
  }, [nativeSave]);
  useEffect(() => {
    if (!nativeSave) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void installExitHandler(
      async () => {
        await flushReadingState();
      },
      (message) => {
        setStorageError(message);
        setCloseError(message);
      },
    )
      .then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      })
      .catch((reason) => {
        setStorageError(String(reason));
        setCloseError(String(reason));
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [nativeSave, flushReadingState]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    applyAppearance(library.preferences, effectiveTheme);
  }, [library.preferences, effectiveTheme]);
  const followSystemTheme = library.preferences.followSystemTheme === true;
  useEffect(() => {
    if (desktop)
      void native
        .setAppearance(effectiveTheme, followSystemTheme)
        .catch(() => {});
  }, [effectiveTheme, followSystemTheme]);
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void listenNativeMenus(
      () => openSettings("updates"),
      () => openSettings(),
    )
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        if (!disposed)
          setStorageError(t("原生菜单暂未连接，请使用窗口内的设置入口。"));
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [openSettings]);
  useEffect(() => {
    if (searchOpen) search.current?.focus();
  }, [searchOpen]);
  useLayoutEffect(() => {
    const navigation = keyboardArticle.current;
    keyboardArticle.current = null;
    const row = selectedArticleRow.current;
    if (navigation?.id !== library.selectedId || !row?.getClientRects().length) return;
    row.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (navigation.moveFocus) row.focus({ preventScroll: true });
  }, [library.selectedId]);
  useLayoutEffect(() => {
    if (!focusUndo.current) return;
    focusUndo.current = false;
    undoButton.current?.focus();
  }, [archivedNotice]);
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setSearchEverywhere(false);
    searchTrigger.current?.focus();
  };

  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3600);
  }, []);
  const article = library.articles.find(
    (article) => article.id === library.selectedId,
  );
  const source = library.sources.find(
    (source) => source.id === article?.sourceId,
  );
  const activeSource = library.sources.find((source) => source.id === sourceId);
  const wholeLibrary = searchOpen && searchEverywhere;
  const visibleUpdates = updates.filter((change) =>
    !library.sources.find((source) => source.id === change.source.id)?.archived,
  );
  const needsFirstRefresh = desktop && !query && view !== "saved" && (
    activeSource?.kind === "pending" ||
    (!activeSource && !library.articles.length && library.sources.some((item) => !item.archived))
  );
  const listSearchLabel = wholeLibrary ? t("搜索全部文章") : activeSource
    ? t("搜索此订阅")
    : view === "saved" ? t("搜索收藏") : view === "unread" ? t("搜索未读文章") : t("搜索全部文章");
  const formatArticleDate = createArticleDateFormatter(locale);
  const articles = useMemo(
    () => filterArticles(
      library, wholeLibrary ? "all" : view, wholeLibrary ? null : sourceId,
      deferredQuery, library.selectedId, cachedArticleText,
    ),
    [library, wholeLibrary, view, sourceId, deferredQuery],
  );
  const readIds = useMemo(() => new Set(library.read), [library.read]);
  const savedIds = useMemo(() => new Set(library.saved), [library.saved]);
  const sourcesById = useMemo(
    () => new Map(library.sources.map((source) => [source.id, source])),
    [library.sources],
  );
  const orderedSources = useMemo(
    () => orderSources(library.sources, library.preferences, locale),
    [library.sources, library.preferences.feedOrder, library.preferences.sortFeedsByName, locale],
  );
  const previousSourceOrder = activeSource && reorderedSourceIds(orderedSources, activeSource.id, -1);
  const nextSourceOrder = activeSource && reorderedSourceIds(orderedSources, activeSource.id, 1);
  const unreadBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of library.articles) {
      if (readIds.has(item.id) || sourcesById.get(item.sourceId)?.archived) continue;
      counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
    }
    return counts;
  }, [library.articles, readIds, sourcesById]);
  const unreadCount = Array.from(unreadBySource.values()).reduce((total, count) => total + count, 0);
  const readBatch = useMemo(
    () => articles.filter((item) => !readIds.has(item.id)).map((item) => item.id),
    [articles, readIds],
  );
  const heading = activeSource?.name ?? t(viewLabels[view]);

  function markBatchRead() {
    if (!readBatch.length || deferredQuery !== query) return;
    setBatchUndo(readBatch);
    setLibrary((current) => ({ ...current, read: [...new Set([...current.read, ...readBatch])] }));
  }

  function undoBatchRead() {
    const batch = new Set(batchUndo);
    setLibrary((current) => ({ ...current, read: current.read.filter((id) => !batch.has(id)) }));
    setBatchUndo([]);
    sourceMenuTrigger.current?.focus();
  }

  const openArticle = useCallback((id: string) => {
    if (libraryRef.current.preferences.markReadOnOpen !== false)
      setBatchUndo((current) => current.includes(id) ? current.filter((item) => item !== id) : current);
    setLibrary((current) => ({
      ...current,
      selectedId: id,
      read:
        current.preferences.markReadOnOpen === false
          ? current.read
          : [...new Set([...current.read, id])],
    }));
    setMobileReader(true);
  }, []);
  const navigate = (nextView: View, nextSource: string | null = null) => {
    const first = filterArticles(library, nextView, nextSource, query, null, cachedArticleText)[0];
    setView(nextView);
    setSourceId(nextSource);
    setSearchEverywhere(false);
    setNavOpen(false);
    setMobileReader(false);
    setLibrary((current) => ({ ...current, selectedId: first?.id ?? null }));
  };
  const toggleSave = useCallback(() => {
    const id = library.selectedId;
    if (!id) return;
    const saved = library.saved.includes(id);
    setLibrary((current) => ({
      ...current,
      saved: saved
        ? current.saved.filter((item) => item !== id)
        : [...current.saved, id],
    }));
    notify(saved ? t("已取消收藏") : t("已收藏，可在「收藏」中找到"));
  }, [library.selectedId, library.saved, notify, t]);
  const toggleRead = () => {
    if (!article) return;
    setBatchUndo((current) => current.includes(article.id) ? current.filter((id) => id !== article.id) : current);
    const read = library.read.includes(article.id);
    setLibrary((current) => ({
      ...current,
      read: read
        ? current.read.filter((id) => id !== article.id)
        : [...current.read, article.id],
    }));
    notify(read ? t("已标为未读") : t("已标为已读"));
  };
  const fetchFullText = async (refresh = false) => {
    if (!desktop || !article?.url || fetchingFullText.has(article.id) || installLocked || restorePending.current) return;
    const { id, url } = article;
    const generation = restoredGeneration.current;
    setFetchingFullText((current) => new Set([...current, id]));
    try {
      const html = await native.fullText(id, url, refresh);
      if (generation !== restoredGeneration.current) return;
      setLibrary((current) => ({
        ...current,
        articles: current.articles.map((item) =>
          item.id === id && item.url === url ? { ...item, fullTextHtml: html } : item,
        ),
      }));
    } catch {
      if (generation === restoredGeneration.current)
        notify(t("无法获取全文，仍可阅读订阅内容或打开原文。"));
    } finally {
      setFetchingFullText((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const openAdd = () => {
    if (sourceMutation.current) return;
    setNavOpen(false);
    setAddOpen(true);
  };

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const editing = (event.target as HTMLElement)?.closest(
        'input, textarea, select, [contenteditable="true"]',
      );
      if (
        desktop && !installLocked && !editing && !event.altKey &&
        (event.metaKey || event.ctrlKey) && ["+", "=", "-"].includes(event.key)
      ) {
        event.preventDefault();
        const delta = event.key === "-" ? -fontSizes.step : fontSizes.step;
        setLibrary((current) => {
          const { min, max, uiDefault } = fontSizes;
          const size = current.preferences.uiFontSize ?? uiDefault;
          const uiFontSize = Math.min(max, Math.max(min, size + delta));
          return size === uiFontSize ? current : {
            ...current,
            preferences: { ...current.preferences, uiFontSize },
          };
        });
        return;
      }
      if (
        editing ||
        document.querySelector(
          '[role="dialog"], [data-radix-popper-content-wrapper]',
        )
      )
        return;
      if (!desktop && (event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        openSettings();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        search.current?.focus();
        setSearchOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        setFocus(false);
        setNavOpen(false);
        return;
      }
      if (event.key === "?") {
        openSettings("shortcuts");
        return;
      }
      if (library.preferences.singleKeyShortcuts === false) return;
      if (["j", "k"].includes(event.key)) {
        event.preventDefault();
        const index = articles.findIndex(
          (item) => item.id === library.selectedId,
        );
        const next = articles[index + (event.key === "j" ? 1 : -1)];
        if (next) {
          keyboardArticle.current = {
            id: next.id,
            moveFocus: event.target instanceof Element && !!event.target.closest(".article-row"),
          };
          openArticle(next.id);
        }
      } else if (event.key === "s") {
        event.preventDefault();
        toggleSave();
      } else if (event.key === "f") {
        event.preventDefault();
        setFocus((value) => !value);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [
    articles,
    installLocked,
    library.selectedId,
    library.preferences.singleKeyShortcuts,
    openArticle,
    toggleSave,
    openSettings,
  ]);

  const mergeChanges = (changes: Changes[], consumePending = false) => {
    setLibrary((current) => {
      let next = current;
      for (const change of changes)
        next = mergeImport(next, [change.source], change.articles);
      return {
        ...next,
        articles: [...next.articles].sort(
          (a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0),
        ),
      };
    });
    if (consumePending) setUpdates((current) => current.filter((change) => !changes.includes(change)));
  };
  const refresh = async (onlySource?: string, automatic = false) => {
    if (!desktop) {
      notify(t("浏览器原型支持文件导入；桌面版可直接联网订阅。"));
      return;
    }
    if (refreshPending.current || sourceMutation.current || restorePending.current || installLocked || addOpen) return;
    const targets = libraryRef.current.sources.filter(
      (item) => item.kind !== "demo" && !item.archived && (!onlySource || item.id === onlySource),
    );
    if (!targets.length) {
      if (!automatic) notify(t("还没有可刷新的订阅。"));
      return;
    }
    refreshPending.current = true;
    const controller = new AbortController();
    refreshAbort.current = controller;
    setRefreshing(true);
    const epoch = operation.current;
    let count = 0;
    const failures: string[] = [];
    for (const source of targets) {
      if (libraryRef.current.sources.find((item) => item.id === source.id)?.archived) continue;
      try {
        const prepared = await native.prepare(
          source.url,
          source.name,
          controller.signal,
        );
        if (epoch !== operation.current) break;
        if (libraryRef.current.sources.find((item) => item.id === source.id)?.archived) continue;
        const change = await native.commit({
          ...prepared,
          source: { ...prepared.source, id: source.id, url: source.url },
        });
        // A committed feed remains available even if the next request is cancelled.
        if (epoch !== operation.current) break;
        count += change.newCount;
        setLibrary((current) => ({
          ...current,
          sources: current.sources.map((s) =>
            s.id === change.source.id
              ? { ...s, kind: change.source.kind, lastError: undefined, lastSuccess: change.source.lastSuccess }
              : s,
          ),
        }));
        setUpdates((current) => queueUpdates(current, [change]));
      } catch (reason) {
        if (epoch !== operation.current) break;
        failures.push(`${source.name}：${String(reason)}`);
        try {
          const status = await native.recordFailure(source.id, String(reason));
          if (epoch === operation.current)
            setLibrary((current) => ({
              ...current,
              sources: current.sources.map((s) =>
                s.id === status.id ? { ...s, lastError: status.lastError } : s,
              ),
            }));
        } catch {
          if (epoch === operation.current)
            setLibrary((current) => ({
              ...current,
              sources: current.sources.map((s) =>
                s.id === source.id
                  ? { ...s, lastError: t("{0}（来源状态暂未保存）", [String(reason)]) }
                  : s,
              ),
            }));
        }
      }
    }
    if (epoch === operation.current) {
      if (!onlySource)
        patchPreferences({
          lastFeedRefresh: {
            at: new Date().toISOString(),
            newCount: count,
            failed: failures.length,
          },
        });
      if (!automatic)
        notify(
          failures.length
            ? failures.join("；")
            : count ? t("已获取 {0} 篇新文章", [count]) : t("订阅已是最新"),
        );
      refreshPending.current = false;
      setRefreshing(false);
    }
  };
  const scheduledRefresh = useEffectEvent(() => { void refresh(undefined, true); });
  useEffect(() => {
    if (desktop && libraryRef.current.preferences.refreshOnLaunch === true) scheduledRefresh();
  }, []);
  const refreshInterval = library.preferences.refreshInterval;
  useEffect(() => {
    if (!desktop || (refreshInterval !== 15 && refreshInterval !== 30 && refreshInterval !== 60)) return;
    const timer = setInterval(() => scheduledRefresh(), refreshInterval * 60_000);
    return () => clearInterval(timer);
  }, [refreshInterval]);
  const stopRefresh = () => {
    operation.current++;
    refreshAbort.current?.abort();
    refreshPending.current = false;
    setRefreshing(false);
  };
  const cancelRefresh = () => {
    stopRefresh();
    notify(t("已停止刷新，已保存的缓存仍保留。"));
  };
  const setSourceArchived = async (source: Source, archived: boolean, fromDrawer = false) => {
    if (sourceMutation.current || restorePending.current || installLocked || addOpen) return;
    const swipeAction = document.activeElement?.closest(".source-unsubscribe");
    sourceMutation.current = true;
    setSourceBusy(true);
    try {
      if (desktop) {
        await nativeSave?.flush();
        await native.setSourceArchived(source.id, archived);
      }
      setLibrary((current) => ({
        ...current,
        sources: current.sources.map((item) =>
          item.id === source.id ? { ...item, archived } : item,
        ),
      }));
      if (archived) {
        setSourceId((current) => current === source.id ? null : current);
        if (fromDrawer) setNavOpen(false);
        const focused = document.activeElement;
        focusUndo.current = !fromDrawer && (
          (swipeAction && (focused === swipeAction || focused === document.body)) ||
          (sourceId === source.id &&
            (focused === sourceMenuTrigger.current || focused === document.body))
        );
        setArchivedNotice(source);
      } else {
        if (document.activeElement === undoButton.current) searchTrigger.current?.focus();
        setArchivedNotice((current) => current?.id === source.id ? null : current);
        notify(t("已恢复订阅。"));
      }
    } catch (reason) {
      notify(String(reason));
    } finally {
      sourceMutation.current = false;
      setSourceBusy(false);
    }
  };
  const editSource = async (source: Source, name: string, folderPath: string[]) => {
    if (sourceMutation.current || restorePending.current || installLocked)
      throw new Error(t("阅读库正在忙，请稍后重试。"));
    sourceMutation.current = true;
    setSourceBusy(true);
    try {
      const updated = desktop
        ? await native.editSource(source.id, name, folderPath)
        : { ...source, name, folder: "", folderPath };
      setLibrary((current) => ({
        ...current,
        sources: current.sources.map((item) => item.id === source.id
          ? { ...item, name: updated.name, folder: updated.folder, folderPath: updated.folderPath }
          : item),
      }));
    } finally {
      sourceMutation.current = false;
      setSourceBusy(false);
    }
  };
  const moveSource = (source: Source, direction: -1 | 1) => {
    const ids = reorderedSourceIds(orderedSources, source.id, direction);
    if (ids) patchPreferences({ feedOrder: ids, sortFeedsByName: false });
  };
  const canMoveSource = (id: string, direction: -1 | 1) =>
    canReorderSource(orderedSources, id, direction);
  const exportLibrary = async (
    name: string,
    contents: string,
    extension: string,
  ) => {
    try {
      if (desktop) {
        if (extension === "json")
          contents = JSON.stringify(
            await native.snapshot(JSON.parse(contents) as Library),
            null,
            2,
          );
        if (await native.export(name, contents, extension))
          notify(t("已导出，可在所选位置找到文件"));
      } else {
        downloadFile(
          name,
          contents,
          extension === "json" ? "application/json" : "text/x-opml",
        );
        notify(t("已导出"));
      }
    } catch (reason) {
      notify(String(reason));
    }
  };
  const chooseRestore = async () => {
    if (!desktop) {
      restoreInput.current?.click();
      return;
    }
    try {
      const file = await native.readFile(true);
      if (!file) return;
      const data: unknown = JSON.parse(file.contents);
      if (!isLibrary(data))
        throw new Error(t("备份格式无效，当前阅读库保持不变。"));
      setRestore(data);
    } catch (reason) {
      notify(String(reason));
    }
  };
  const importFile = async (
    file: File,
    submission: Submission,
  ): Promise<string | undefined> => {
    if (file.size > 5 * 1024 * 1024) return t("请选择小于 5 MB 的订阅文件。");
    try {
      const contents = await file.text();
      if (!submission.isCurrent()) return "";
      const imported = parseFeedFile(contents);
      if (desktop) {
        await nativeSave?.flush();
        const current = libraryRef.current;
        const urls = new Set(imported.sources.map((source) => source.url));
        const importedLibrary = mergeImport(
          {
            ...current,
            sources: current.sources.filter((source) => urls.has(source.url)),
            articles: [],
            read: [], saved: [], positions: {}, selectedId: null,
          },
          imported.sources,
          imported.articles,
        );
        if (!submission.beginCommit()) return "";
        const result = await native.importFeedFile(importedLibrary);
        const visible = libraryRef.current.articles;
        setUpdates((pending) => discardImportedUpdates(pending, result.articles, visible));
        setLibrary((current) => mergeImport(current, result.sources, result.articles));
      } else if (submission.beginCommit())
        setLibrary((current) => ({
          ...mergeImport(current, imported.sources, imported.articles),
          selectedId: imported.articles[0]?.id ?? null,
        }));
      setView("all");
      setSourceId(
        libraryRef.current.sources.find(
          (source) => source.url === imported.sources[0]?.url,
        )?.id ??
          imported.sources[0]?.id ??
          null,
      );
      setQuery("");
      notify(
        imported.articles.length
          ? t("已导入 {0} 篇文章，重复内容已合并", [imported.articles.length])
          : desktop
            ? t("订阅地址已导入，点击刷新获取文章")
            : t("订阅地址已导入，桌面版可联网更新"),
      );
    } catch (error) {
      return error instanceof Error
        ? error.message
        : t("导入失败，请检查文件后重试。");
    }
  };

  useEffect(() => {
    if (!installLocked) return;
    const block = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-update-dialog]")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = ["click", "pointerdown", "keydown", "beforeinput", "wheel"];
    events.forEach((name) =>
      document.addEventListener(name, block, { capture: true, passive: false }),
    );
    return () =>
      events.forEach((name) => document.removeEventListener(name, block, true));
  }, [installLocked]);
  const updatePanel = useUpdateCenter({
    enabled: desktop,
    onContinue: () => setSettingsSection(null),
    preferences: library.preferences,
    onPreferences: patchPreferences,
    onAvailable: setNewVersion,
    libraryBusy: refreshing || addOpen || !!restore || sourceBusy || fetchingFullText.size > 0,
    onLock: (locked) => {
      if (locked) operation.current++;
      setInstallLocked(locked);
    },
    save: flushReadingState,
  });
  const refreshLabel = t(refreshing ? "停止刷新" : "刷新订阅");
  const refreshStatusLabel = t("订阅更新状态");
  const failedSources = desktop ? orderedSources.filter((source) => source.lastError) : [];
  const lastRefresh = library.preferences.lastFeedRefresh;
  const refreshSummary = lastRefresh &&
    typeof lastRefresh.at === "string" &&
    Number.isFinite(Date.parse(lastRefresh.at)) &&
    Number.isSafeInteger(lastRefresh.newCount) &&
    Number.isSafeInteger(lastRefresh.failed)
    ? t("{0} · 新增 {1} · 失败 {2}", [
        new Date(lastRefresh.at).toLocaleString(locale), lastRefresh.newCount, lastRefresh.failed,
      ])
    : "";
  const renderSidebar = (drawer = false) => (
    <aside className="sidebar" aria-label={t("阅读库导航")}>
      <header className="brand-header">
        <span className="wordmark">
          <BookOpenIcon size={28} aria-hidden="true" />
          {t("墨牍")}
        </span>
      </header>
      <nav className="primary-nav" aria-label={t("文章分类")}>
        {navigation.map(([key, Icon]) => (
          <button
            key={key}
            className={`nav-item ${view === key && !sourceId ? "active" : ""}`}
            aria-current={view === key && !sourceId ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            <Icon size={23} />
            <span>{t(viewLabels[key])}</span>
            {key === "unread" && unreadCount > 0 && (
              <span className="nav-count">{unreadCount}</span>
            )}
          </button>
        ))}
      </nav>
      <section className="sources-section">
        <div className="subscription-heading">
          <h2>{t("订阅")}</h2>
          <div className="subscription-tools">
            {desktop && (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    className="icon-button refresh-status-button"
                    aria-label={refreshStatusLabel}
                    title={refreshStatusLabel}
                  >
                    <ClockCounterClockwiseIcon size={19} aria-hidden="true" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    className="source-actions feed-refresh-popover"
                    aria-label={refreshStatusLabel}
                    align="end"
                    sideOffset={6}
                    collisionPadding={12}
                  >
                    <header className="feed-refresh-heading">
                      <strong>{refreshStatusLabel}</strong>
                      <Popover.Close asChild>
                        <button className="icon-button" aria-label={t("收起更新结果")} title={t("收起更新结果")}>
                          <XIcon size={17} aria-hidden="true" />
                        </button>
                      </Popover.Close>
                    </header>
                    <p className="feed-refresh-summary" role="status">
                      {refreshing ? t("正在刷新订阅…") : refreshSummary || (!failedSources.length && t("还没有刷新记录。"))}
                    </p>
                    {failedSources.length > 0 && (
                      <>
                        <ul className="feed-errors">
                          {failedSources.map((source) => (
                            <li key={source.id}>
                              <strong>{t("{0} 更新失败", [source.name])}</strong>
                              <p>{source.lastError}</p>
                              <button
                                className="quiet-button"
                                aria-label={t("重试 {0}", [source.name])}
                                disabled={refreshing || sourceBusy}
                                onClick={() => void refresh(source.id)}
                              >
                                {t("重试此订阅")}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <p className="feed-refresh-hint">{t("缓存文章仍可阅读")}</p>
                      </>
                    )}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}
            <button
              className="icon-button"
              aria-label={t("添加订阅")}
              title={t("添加订阅")}
              disabled={sourceBusy}
              onClick={openAdd}
            >
              <PlusIcon size={19} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              aria-label={refreshLabel}
              title={refreshLabel}
              disabled={sourceBusy && !refreshing}
              onClick={() => refreshing ? cancelRefresh() : void refresh()}
            >
              {refreshing ? (
                <XIcon size={19} aria-hidden="true" />
              ) : (
                <ArrowClockwiseIcon size={19} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <SubscriptionList
          sources={orderedSources}
          unreadBySource={unreadBySource}
          selectedId={sourceId}
          busy={sourceBusy}
          onSelect={(id) => navigate("all", id)}
          onEdit={(source) => setSourceToEdit(source)}
          onMove={moveSource}
          onUnsubscribe={(source) => void setSourceArchived(source, true, drawer)}
        />
      </section>
      <div className="sidebar-bottom">
        {desktop && newVersion && (
          <button
            className="update-available quiet-button"
            onClick={(event) => openSettings("updates", event.currentTarget)}
          >
            {t("墨牍 {0} 可用", [newVersion])}
          </button>
        )}
        <button
          className="quiet-button sidebar-settings"
          ref={drawer ? undefined : settingsTrigger}
          title={t("设置 · ⌘,")}
          onClick={(event) => {
            openSettings(
              "appearance",
              drawer ? navTrigger.current ?? undefined : event.currentTarget,
            );
          }}
        >
          <GearSixIcon size={20} aria-hidden="true" />
          {t("设置")}
        </button>
        {storageError && (
          <p className="storage-error" role="alert">
            <span className="sr-only">{t(storageError)}</span>
            <button
              className="quiet-button"
              onClick={(event) => openSettings("library", event.currentTarget)}
            >
              {t("保存出现问题")}
            </button>
          </p>
        )}
      </div>
    </aside>
  );

  const content = (
    <div
      className={`app-shell ${focus ? "is-focused" : ""} ${mobileReader ? "show-reader" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        {t("跳到正文")}
      </a>
      {renderSidebar()}
      <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
        <Dialog.Trigger asChild>
          <button
            className="icon-button sidebar-toggle open-nav"
            ref={navTrigger}
            aria-label={t("打开导航")}
          >
            <SidebarSimpleIcon size={23} aria-hidden="true" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="nav-backdrop" />
          <Dialog.Content
            className="sidebar-drawer"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              if (document.querySelector(".settings-dialog, .subscription-dialog"))
                event.preventDefault();
            }}
          >
            <Dialog.Title className="sr-only">{t("阅读库导航")}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button sidebar-toggle close-nav" aria-label={t("关闭导航")}>
                <XIcon size={20} aria-hidden="true" />
              </button>
            </Dialog.Close>
            {renderSidebar(true)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <section
        className="article-list"
        aria-label={t("文章列表")}
        onKeyDown={(event) => {
          if (!searchOpen || event.key !== "Escape" || event.nativeEvent.isComposing ||
            event.keyCode === 229 || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
          event.preventDefault();
          event.stopPropagation();
          closeSearch();
        }}
      >
        <header className="list-header">
          <div className="list-title-row">
            <h1 title={heading}>{heading}</h1>
            <button
              className={`icon-button search-toggle ${searchOpen ? "search-active" : ""}`}
              ref={searchTrigger}
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? "article-search" : undefined}
              aria-label={searchOpen ? t("关闭搜索") : t("搜索文章")}
              title={t(searchOpen ? "关闭搜索" : "搜索 · ⌘K")}
              onClick={() => {
                if (searchOpen) closeSearch();
                else setSearchOpen(true);
              }}
            >
              {searchOpen ? <XIcon size={22} /> : <MagnifyingGlassIcon size={24} />}
            </button>
            {(
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    className="icon-button"
                    aria-label={activeSource ? t("订阅操作") : t("文章列表选项")}
                    title={activeSource ? t("订阅操作") : t("文章列表选项")}
                    ref={sourceMenuTrigger}
                    aria-disabled={sourceBusy}
                    onClick={(event) => {
                      if (sourceMutation.current) event.preventDefault();
                    }}
                  >
                    <DotsThreeIcon size={24} weight="bold" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    className="source-actions list-operations"
                    aria-label={activeSource ? t("订阅操作") : t("文章列表选项")}
                    align="end"
                    sideOffset={6}
                  >
                    <Popover.Close asChild>
                      <button className="quiet-button" disabled={!readBatch.length || deferredQuery !== query} onClick={markBatchRead}>
                        {t(deferredQuery.trim() ? "搜索结果标为已读（{0} 篇）" : "全部标为已读（{0} 篇）", [readBatch.length])}
                      </button>
                    </Popover.Close>
                    <button
                      className="quiet-button"
                      aria-pressed={library.preferences.compactList === true}
                      onClick={() => patchPreferences({ compactList: !library.preferences.compactList })}
                    >
                      {t("紧凑列表")}
                    </button>
                    {activeSource && (
                      <>
                        <Popover.Close asChild>
                          <button className="quiet-button" onClick={() => setSourceToEdit(activeSource)}>
                            {t("编辑订阅")}
                          </button>
                        </Popover.Close>
                        <button
                          className="quiet-button"
                          disabled={!previousSourceOrder}
                          onClick={() => patchPreferences({ feedOrder: previousSourceOrder, sortFeedsByName: false })}
                        >{t("上移订阅")}</button>
                        <button
                          className="quiet-button"
                          disabled={!nextSourceOrder}
                          onClick={() => patchPreferences({ feedOrder: nextSourceOrder, sortFeedsByName: false })}
                        >{t("下移订阅")}</button>
                      </>
                    )}
                    {activeSource && <Popover.Close asChild>
                      <button
                        className="quiet-button"
                        onClick={() => void setSourceArchived(activeSource, true)}
                      >
                        <ArchiveIcon size={17} aria-hidden="true" />
                        {t("取消订阅")}
                      </button>
                    </Popover.Close>}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}
          </div>
          {searchOpen ? (
            <div id="article-search" className="list-search" role="search" aria-label={t("搜索文章")}>
              <div className="search-field">
                <MagnifyingGlassIcon size={17} aria-hidden="true" />
                <input
                  ref={search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={listSearchLabel}
                  placeholder={t("搜索")}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label={t("清空搜索")}
                    onClick={() => {
                      setQuery("");
                      search.current?.focus();
                    }}
                  >
                    <XIcon size={15} />
                  </button>
                )}
                {(sourceId || view !== "all") && (
                  <div className="search-scope setting-select-wrap">
                    <select
                      aria-label={t("搜索范围")}
                      value={searchEverywhere ? "all" : "current"}
                      onChange={(event) => setSearchEverywhere(event.target.value === "all")}
                    >
                      <option value="current">{t(sourceId ? "当前订阅" : "当前列表")}</option>
                      <option value="all">{t("全部文章")}</option>
                    </select>
                    <CaretDownIcon size={13} aria-hidden="true" />
                  </div>
                )}
              </div>
              <span className="sr-only" role="status">
                {wholeLibrary
                  ? t("全库 · {0} 篇文章", [articles.length])
                  : t("{0} 篇文章{1}", [articles.length, ""])}
              </span>
            </div>
          ) : (
            <p className="list-subtitle">
              {sourceId
                ? t("{0} 篇文章{1}", [articles.length, activeSource?.kind === "demo" ? t(" · 示例订阅") : ""])
                : view === "saved"
                  ? t("{0} 篇值得再读的文章", [articles.length])
                  : new Intl.DateTimeFormat(locale, {
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    }).format(new Date())}
            </p>
          )}
        </header>
        {archivedNotice && (
          <div className="source-notice">
            <span role="status">{t("已取消订阅 {0}", [archivedNotice.name])}</span>
            <button
              className="quiet-button"
              ref={undoButton}
              aria-disabled={sourceBusy}
              onClick={() => void setSourceArchived(archivedNotice, false)}
            >
              {t("撤销")}
            </button>
            <button
              className="icon-button"
              aria-label={t("关闭提示")}
              disabled={sourceBusy}
              onClick={() => {
                searchTrigger.current?.focus();
                setArchivedNotice(null);
              }}
            >
              <XIcon size={17} />
            </button>
          </div>
        )}
        {batchUndo.length > 0 && (
          <div className="source-notice">
            <span role="status">{t("已将 {0} 篇文章标为已读", [batchUndo.length])}</span>
            <button className="quiet-button" onClick={undoBatchRead}>{t("撤销")}</button>
            <button className="icon-button" aria-label={t("关闭提示")} onClick={() => setBatchUndo([])}>
              <XIcon size={17} />
            </button>
          </div>
        )}
        {visibleUpdates.length > 0 && (
          <button
            className="updates-banner"
            onClick={() => mergeChanges(visibleUpdates, true)}
          >
            {visibleUpdates.reduce((n, c) => n + c.newCount, 0)
              ? t("{0} 篇新文章 · 点击载入", [visibleUpdates.reduce((n, c) => n + c.newCount, 0)])
              : t("订阅已刷新 · 点击载入")}
          </button>
        )}
        <div className={`article-list-scroll ${library.preferences.compactList ? "compact-list" : ""}`}>
          {articles.length ? (
            articles.map((item) => {
              const itemSource = sourcesById.get(item.sourceId);
              const unread = !readIds.has(item.id);
              const publication = formatArticleDate(item.date);
              return (
                <button
                  key={item.id}
                  ref={library.selectedId === item.id ? selectedArticleRow : undefined}
                  className={`article-row ${library.selectedId === item.id ? "selected" : ""} ${unread ? "unread" : "read"}`}
                  aria-current={
                    library.selectedId === item.id ? "true" : undefined
                  }
                  onClick={() => openArticle(item.id)}
                >
                  <span className="article-status">
                    {unread ? <CircleIcon weight="fill" size={11} /> : null}
                  </span>
                  <div className="article-row-content">
                    <h2
                      lang={item.title.startsWith("A small") ? "en" : "zh-CN"}
                    >
                      {item.title}
                    </h2>
                    <p className="article-excerpt">
                      {item.excerpt || t("打开文章，继续阅读。")}
                    </p>
                    <div className="article-row-meta">
                      <span className="article-source" title={itemSource?.name}>{itemSource?.name}</span>
                      {publication
                        ? <time dateTime={publication.dateTime}>{publication.label}</time>
                        : <span>{t("日期未知")}</span>}
                      {savedIds.has(item.id) && (
                        <BookmarkSimpleIcon
                          className="row-bookmark"
                          size={14}
                          weight="fill"
                          aria-label={t("已收藏")}
                        />
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : needsFirstRefresh ? (
            visibleUpdates.length === 0 && (
              <div className="list-empty">
                <RssIcon size={31} weight="bold" aria-hidden="true" />
                <h2>{t(refreshing ? "正在刷新订阅…" : "还没有文章")}</h2>
                {!refreshing && (
                  <button className="quiet-button" disabled={sourceBusy} onClick={() => void refresh(activeSource?.id)}>
                    {t("刷新订阅")}
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="list-empty">
              {query ? (
                <MagnifyingGlassIcon size={31} weight="light" />
              ) : view === "saved" ? (
                <BookmarkSimpleIcon size={31} weight="light" />
              ) : (
                <ArchiveIcon size={31} weight="light" />
              )}
              <h2>
                {query
                  ? t("没有找到相关文章")
                  : view === "saved"
                    ? t("把好文章留下来")
                    : activeSource?.kind === "pending"
                      ? t("订阅地址已保存")
                      : library.sources.length
                        ? t("未读已清空")
                        : t("从一份喜欢的订阅开始")}
              </h2>
              <p>
                {query
                  ? t("试试更短的关键词，或搜索来源名称。")
                  : view === "saved"
                    ? t("阅读时点击书签，值得重读的文章会出现在这里。")
                    : activeSource?.kind === "pending"
                      ? t("可以导入这个来源的 RSS 或 Atom 文件。")
                      : library.sources.length
                        ? t("去全部文章看看，或添加一个新的订阅。")
                        : t("添加博客或技术资讯，在本机安静阅读。")}
              </p>
              {query.trim() && !wholeLibrary && (sourceId || view !== "all") && (
                <button className="quiet-button" onClick={() => {
                  setSearchEverywhere(true);
                  search.current?.focus();
                }}>
                  {t("搜索全部文章")}
                </button>
              )}
              {!query && (
                <button
                  className="quiet-button"
                  onClick={() =>
                    activeSource?.kind === "pending"
                      ? openAdd()
                      : library.sources.length
                        ? navigate("all")
                        : openAdd()
                  }
                >
                  {activeSource?.kind === "pending"
                    ? t("导入文章")
                    : library.sources.length
                      ? t("浏览全部文章")
                      : t("添加订阅")}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      <Reader
        article={article}
        source={source}
        saved={!!article && savedIds.has(article.id)}
        read={!!article && readIds.has(article.id)}
        onFullText={desktop ? (refresh) => void fetchFullText(refresh) : undefined}
        fetchingFullText={!!article && fetchingFullText.has(article.id)}
        effectiveTheme={effectiveTheme}
        preferences={library.preferences}
        focus={focus}
        getPosition={(key) => positions.current[key] ?? 0}
        onSave={toggleSave}
        onRead={toggleRead}
        onFocus={() => setFocus((value) => !value)}
        onBack={() => setMobileReader(false)}
        onPreferences={patchPreferences}
        onPosition={(id, position) => {
          positions.current[id] = position;
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(
            () => persist(libraryRef.current),
            250,
          );
        }}
      />
      {sourceToEdit && (
        <SourceEditDialog
          key={sourceToEdit.id}
          source={sourceToEdit}
          sources={library.sources}
          onSave={(name, path) => editSource(sourceToEdit, name, path)}
          onClose={() => {
            setSourceToEdit(null);
            requestAnimationFrame(() => sourceMenuTrigger.current?.focus());
          }}
        />
      )}
      <SubscriptionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        demoAdded={library.sources.some(
          (source) => source.id === extraSource.id,
        )}
        onDemo={() => {
          setLibrary((current) => ({
            ...mergeImport(current, [extraSource], [extraArticle]),
            selectedId: extraArticle.id,
          }));
          setView("all");
          setSourceId(extraSource.id);
          setQuery("");
          notify(t("已添加慢写周刊示例订阅"));
        }}
        onNativeFile={
          desktop
            ? async (submission) => {
                const file = await native.readFile(false);
                return file && submission.isCurrent()
                  ? importFile(new File([file.contents], file.name), submission)
                  : "";
              }
            : undefined
        }
        onAdd={async (input, name, submission) => {
          const url = httpUrl(input.trim());
          if (!url) return t("请输入以 http:// 或 https:// 开头的网站或 RSS 地址。");
          if (
            library.sources.some(
              (source) => source.url === url && source.archived,
            )
          )
            return t("这个来源已取消订阅，可在「阅读库选项」中恢复。");
          if (
            library.sources.some(
              (source) => source.url === url && !source.archived,
            )
          )
            return t("这个订阅已经在阅读库中。");
          if (desktop) {
            try {
              const prepared = await native.prepare(
                url,
                name,
                submission.signal,
              );
              if (!submission.beginCommit()) return "";
              const change = await native.commit(prepared);
              mergeChanges([change]);
              setSourceId(change.source.id);
              setView("all");
              setQuery("");
              notify(
                t("已添加 {0}，共 {1} 篇文章", [change.source.name, change.articles.length]),
              );
            } catch (reason) {
              return String(reason);
            }
            return;
          }
          if (!submission.beginCommit()) return "";
          const source = {
            id: `feed:${encodeURIComponent(url)}`,
            name: name.trim() || new URL(url).hostname,
            url,
            kind: "pending" as const,
          };
          setLibrary((current) => ({
            ...current,
            sources: [...current.sources, source],
            selectedId: null,
          }));
          setSourceId(source.id);
          setView("all");
          setQuery("");
          notify(t("订阅地址已保存，等待桌面版联网更新"));
        }}
        onFile={importFile}
      />

      <input
        type="file"
        ref={restoreInput}
        hidden
        accept=".json,application/json"
        aria-label={t("选择阅读库备份")}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 5 * 1024 * 1024)
              throw new Error(t("备份不能超过 5 MB。"));
            const data: unknown = JSON.parse(await file.text());
            if (!isLibrary(data))
              throw new Error(t("备份格式无效，当前阅读库保持不变。"));
            setRestore(data);
          } catch (error) {
            notify(error instanceof Error ? error.message : t("无法读取备份"));
          } finally {
            event.target.value = "";
          }
        }}
      />
      <Dialog.Root
        open={!!restore}
        onOpenChange={(open) => {
          if (!open && !restorePending.current) {
            setRestore(null);
            setRestoreError("");
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="shortcuts-dialog">
            <Dialog.Title>{t("恢复阅读库")}</Dialog.Title>
            <Dialog.Description>
              {t("备份包含 {0} 个订阅和 {1} 篇文章。", [restore?.sources.length, restore?.articles.length])}
              {desktop
                ? t("恢复将替换当前本地阅读库，并自动保留恢复前的备份。")
                : t("恢复将替换当前浏览器中的阅读库；建议先导出当前备份。")}
            </Dialog.Description>
            {restoreError && (
              <p className="form-error" role="alert">
                {restoreError}
              </p>
            )}
            <div className="confirm-actions">
              <button
                className="quiet-button"
                disabled={restoreBusy}
                onClick={() => setRestore(null)}
              >
                {t("取消")}
              </button>
              <button
                className="primary-button"
                disabled={restoreBusy || sourceBusy}
                onClick={async () => {
                  if (!restore || restorePending.current || sourceMutation.current) return;
                  restorePending.current = true;
                  setRestoreBusy(true);
                  setRestoreError("");
                  if (desktop) {
                    try {
                      stopRefresh();
                      await nativeSave?.flush();
                      const result = await native.import(restore, true);
                      nativeSave?.resetRevision(result.revision);
                      restoredGeneration.current++;
                      positions.current = result.library.positions;
                      setLibrary({
                        ...result.library,
                        preferences: normalizePreferences(
                          result.library.preferences,
                        ),
                      });
                      setUpdates([]);
                      setArchivedNotice(null);
                      setBatchUndo([]);
                      setSourceId(null);
                      setView("all");
                      setRestore(null);
                      notify(t("阅读库已恢复，恢复前备份已保存"));
                    } catch (reason) {
                      setRestoreError(String(reason));
                    } finally {
                      restorePending.current = false;
                      setRestoreBusy(false);
                    }
                    return;
                  }
                  restoredGeneration.current++;
                  positions.current = restore.positions;
                  setArchivedNotice(null);
                  setBatchUndo([]);
                  setLibrary({
                    ...restore,
                    preferences: normalizePreferences(restore.preferences),
                  });
                  setSourceId(null);
                  setView("all");
                  setRestore(null);
                  notify(t("阅读库已恢复"));
                  restorePending.current = false;
                  setRestoreBusy(false);
                }}
              >
                {restoreBusy ? t("正在恢复…") : t("使用此备份恢复")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <CloseRecoveryDialog
        error={closeError}
        onError={setCloseError}
        save={async () => {
          await flushReadingState();
        }}
        exportBackup={async () => {
          const snapshot = await native.snapshot({
            ...libraryRef.current,
            positions: { ...positions.current },
          });
          return native.export(
            "墨牍-未保存阅读库备份.json",
            JSON.stringify(snapshot, null, 2),
            "json",
          );
        }}
      />
      <SettingsDialog
        section={settingsSection}
        onSectionChange={setSettingsSection}
        restoreFocus={() => {
          const origin = settingsOrigin.current;
          if (origin?.isConnected && origin.getClientRects().length)
            origin.focus();
          else if (navTrigger.current?.getClientRects().length)
            navTrigger.current.focus();
          else if (settingsTrigger.current?.getClientRects().length)
            settingsTrigger.current.focus();
        }}
        locked={installLocked}
        preferences={library.preferences}
        effectiveTheme={effectiveTheme}
        onPreferences={patchPreferences}
        dataPath={loaded?.dataPath}
        storageError={t(storageError)}
        notice={t(notice)}
        archivedSources={library.sources.filter((source) => source.archived)}
        sourceBusy={sourceBusy}
        onRestoreSource={(source) => setSourceArchived(source, false)}
        onExportBackup={() =>
          exportLibrary(
            "墨牍-阅读库备份.json",
            JSON.stringify(
              { ...libraryRef.current, positions: positions.current },
              null,
              2,
            ),
            "json",
          )
        }
        onRestoreBackup={() => void chooseRestore()}
        onExportOpml={async () => {
          const sources = orderedSources.filter((source) => source.kind !== "demo");
          if (!sources.length) {
            notify(t("添加自己的订阅后即可导出 OPML。"));
            return;
          }
          await exportLibrary("墨牍-订阅.opml", exportOpml(sources), "opml");
        }}
        sources={orderedSources}
        unreadBySource={unreadBySource}
        onEditSource={(source, name, path) => editSource(source, name, path)}
        onArchiveSource={(source) => void setSourceArchived(source, true)}
        onMoveSource={moveSource}
        canMoveSource={canMoveSource}
        updatePanel={
          desktop ? (
            updatePanel
          ) : (
            <p className="settings-note">
              {t("当前为浏览器版。应用内更新适用于 macOS 桌面版。")}
            </p>
          )
        }
      />
      <div
        className={`toast ${notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {t(notice)}
      </div>
    </div>
  );
  return <LocaleContext.Provider value={locale}>{content}</LocaleContext.Provider>;
}
