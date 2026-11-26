import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CaretRightIcon,
  FolderIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "./locale-context";
import { SourceEditForm } from "./SourceEditDialog";
import { groupSources } from "./source-layout";
import type { Source } from "./model";

type Group = ReturnType<typeof groupSources>;

type Props = {
  sources: Source[];
  unreadBySource: ReadonlyMap<string, number>;
  busy: boolean;
  onEdit: (source: Source, name: string, path: string[]) => Promise<void>;
  onRenameFolder: (path: string[], name: string) => Promise<void>;
  onArchive: (source: Source) => void;
  onMove: (source: Source, direction: -1 | 1) => void;
  canMove: (id: string, direction: -1 | 1) => boolean;
};

function countSources(group: Group): number {
  return (
    group.sources.length +
    [...group.groups.values()].reduce((total, child) => total + countSources(child), 0)
  );
}

export function SubscriptionManager({
  sources,
  unreadBySource,
  busy,
  onEdit,
  onRenameFolder,
  onArchive,
  onMove,
  canMove,
}: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const tree = useMemo(() => groupSources(sources), [sources]);

  const indentFor = (depth: number) => Math.min(depth, 4) * 14 + 4;

  function toggleFolder(path: string[]) {
    const key = JSON.stringify(path);
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderSource(source: Source, depth: number): ReactNode {
    const indent = { paddingInlineStart: indentFor(depth) };
    if (editingId === source.id) {
      return (
        <div className="manager-row manager-editing" key={source.id} style={indent}>
          <p className="manager-url">{source.url}</p>
          <SourceEditForm
            source={source}
            sources={sources}
            onSave={async (name, nextPath) => {
              await onEdit(source, name, nextPath);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
            autoFocus
          />
        </div>
      );
    }
    const unread = unreadBySource.get(source.id) ?? 0;
    return (
      <div className="manager-row" key={source.id} style={indent}>
        <div className="manager-info">
          <span className="manager-name">{source.name}</span>
          {unread > 0 && (
            <span className="manager-meta">{t("{0} 篇未读", [unread])}</span>
          )}
          <span className="manager-url" title={source.url}>{source.url}</span>
        </div>
        <div className="manager-actions">
          <button
            className="icon-button"
            aria-label={t("编辑 {0}", [source.name])}
            title={t("编辑")}
            disabled={busy}
            onClick={() => setEditingId(source.id)}
          >
            <PencilSimpleIcon size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            aria-label={t("上移 {0}", [source.name])}
            title={t("上移")}
            disabled={busy || !canMove(source.id, -1)}
            onClick={() => onMove(source, -1)}
          >
            <ArrowUpIcon size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            aria-label={t("下移 {0}", [source.name])}
            title={t("下移")}
            disabled={busy || !canMove(source.id, 1)}
            onClick={() => onMove(source, 1)}
          >
            <ArrowDownIcon size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button manager-remove"
            aria-label={t("取消订阅 {0}", [source.name])}
            title={t("取消订阅")}
            disabled={busy}
            onClick={() => onArchive(source)}
          >
            <TrashIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  function renderGroup(group: Group, path: string[], depth: number): ReactNode {
    const key = JSON.stringify(path);
    const isCollapsed = group.name.length > 0 && collapsed.has(key);
    const childDepth = group.name ? depth + 1 : depth;
    const children = [
      ...group.sources.map((source) => renderSource(source, childDepth)),
      ...[...group.groups.entries()].map(([name, child]) =>
        renderGroup(child, [...path, name], childDepth),
      ),
    ];
    if (!group.name) return <>{children}</>;
    const indent = { paddingInlineStart: indentFor(depth) };
    return (
      <div className="manager-group" key={key}>
        <div className="manager-folder" style={indent}>
          {editingFolder === key ? (
            <form
              className="manager-folder-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const next = folderName.trim();
                if (!next || busy) return;
                try {
                  await onRenameFolder(path, next);
                  setEditingFolder(null);
                  setFolderError("");
                } catch (reason) {
                  setFolderError(t(String(reason)));
                }
              }}
            >
              <input
                aria-label={t("文件夹名称")}
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                maxLength={120}
                autoFocus
              />
              <button
                className="quiet-button"
                type="button"
                onClick={() => { setEditingFolder(null); setFolderError(""); }}
              >
                {t("取消")}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy || !folderName.trim()}
              >
                {t("保存")}
              </button>
              {folderError && <p className="form-error" role="alert">{folderError}</p>}
            </form>
          ) : (
            <>
              <button
                type="button"
                className="manager-folder-toggle"
                aria-expanded={!isCollapsed}
                aria-label={t(isCollapsed ? "展开 {0}" : "收起 {0}", [path.join(" / ")])}
                onClick={() => toggleFolder(path)}
              >
                {isCollapsed
                  ? <CaretRightIcon size={16} aria-hidden="true" />
                  : <CaretDownIcon size={16} aria-hidden="true" />}
                <FolderIcon size={18} aria-hidden="true" />
                <span className="manager-folder-name">{group.name}</span>
                <span className="manager-folder-count">{countSources(group)}</span>
              </button>
              <button
                type="button"
                className="icon-button manager-folder-edit"
                aria-label={t("编辑文件夹 {0}", [path.join(" / ")])}
                title={t("编辑")}
                disabled={busy}
                onClick={() => {
                  setEditingFolder(key);
                  setFolderName(group.name);
                  setFolderError("");
                }}
              >
                <PencilSimpleIcon size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {!isCollapsed && children}
      </div>
    );
  }

  return (
    <div className="manager-panel" aria-busy={busy}>
      <p className="manager-hint">{t("在这里编辑名称与分组、调整顺序或取消订阅。")}</p>
      <div className="manager-list">
        {sources.length === 0 && (
          <p className="manager-empty">{t("还没有订阅。")}</p>
        )}
        {renderGroup(tree, [], 0)}
      </div>
    </div>
  );
}
