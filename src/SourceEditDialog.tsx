import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useTranslation } from "./locale-context";
import { availableFolders, folderPath, parseFolderPath } from "./source-layout";
import type { Source } from "./model";

export function SourceEditForm({ source, sources, onSave, onCancel, autoFocus }: {
  source: Source;
  sources: Source[];
  onSave: (name: string, path: string[]) => Promise<void>;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const folders = availableFolders(sources);
  const [name, setName] = useState(source.name);
  const [folder, setFolder] = useState(JSON.stringify(folderPath(source)));
  const [newFolder, setNewFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form className="source-edit-form" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      const path = folder === "new" ? parseFolderPath(newFolder) : folders.get(folder) ?? [];
      if ((folder === "new" && !path.length) || path.length > 32 ||
          path.some((part) => part.length > 120)) {
        setError(t("请输入有效的分组名称。"));
        return;
      }
      setBusy(true);
      setError("");
      try {
        await onSave(name.trim(), path);
      } catch (reason) {
        setError(t(String(reason)));
        setBusy(false);
      }
    }}>
      <label>
        {t("显示名称")}
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required autoFocus={autoFocus} />
      </label>
      <label>
        {t("订阅分组")}
        <select className="setting-select" value={folder} onChange={(event) => setFolder(event.target.value)}>
          <option value="[]">{t("未分组")}</option>
          {[...folders].map(([key, path]) => (
            <option key={key} value={key}>{path.join(" / ")}</option>
          ))}
          <option value="new">{t("新建分组…")}</option>
        </select>
      </label>
      {folder === "new" && (
        <label>
          {t("新分组名称")}
          <input
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder={t("例如 技术 / Rust")}
            required
          />
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button className="quiet-button" type="button" disabled={busy} onClick={onCancel}>{t("取消")}</button>
        <button className="primary-button" type="submit" disabled={busy || !name.trim()}>{t("保存")}</button>
      </div>
    </form>
  );
}

export function SourceEditDialog({ source, sources, onSave, onClose }: {
  source: Source;
  sources: Source[];
  onSave: (name: string, path: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="subscription-dialog">
          <Dialog.Title>{t("编辑订阅")}</Dialog.Title>
          <Dialog.Description>{source.url}</Dialog.Description>
          <SourceEditForm
            source={source}
            sources={sources}
            onSave={async (name, path) => { await onSave(name, path); onClose(); }}
            onCancel={onClose}
            autoFocus
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
