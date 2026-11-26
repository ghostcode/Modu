import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSimpleIcon,
  RssSimpleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "./locale-context";
import type { Source } from "./model";
import { canReorderSource, groupSources } from "./source-layout";

const swipeThreshold = 40;
const wheelGestureGap = 160;

function sourceRow(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(".source-row")
    : null;
}

type Drag = {
  row: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  width: number;
  startOffset: number;
};

export function SubscriptionList({
  sources,
  unreadBySource,
  selectedId,
  busy,
  onSelect,
  onEdit,
  onMove,
  onUnsubscribe,
}: {
  sources: Source[];
  unreadBySource: ReadonlyMap<string, number>;
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onEdit: (source: Source) => void;
  onMove: (source: Source, direction: -1 | 1) => void;
  onUnsubscribe: (source: Source) => void;
}) {
  const { t, locale } = useTranslation();
  const list = useRef<HTMLElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const nav = list.current;
    if (!nav) return;
    let wheel = { id: "", time: -Infinity, distance: 0, handled: false };
    const onWheel = (event: WheelEvent) => {
      const id = sourceRow(event.target)?.dataset.sourceId;
      if (!id || event.ctrlKey || Math.abs(event.deltaX) <= 1.25 * Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (event.timeStamp - wheel.time > wheelGestureGap)
        wheel = { id, time: event.timeStamp, distance: 0, handled: false };
      wheel.time = event.timeStamp;
      if (wheel.handled || wheel.id !== id) return;
      const unit = event.deltaMode === 1 ? 16
        : event.deltaMode === 2 ? nav.clientWidth : 1;
      wheel.distance += event.deltaX * unit;
      if (Math.abs(wheel.distance) < swipeThreshold) return;
      wheel.handled = true;
      if (wheel.distance > 0) setOpenId(id);
      else setOpenId((current) => current === id ? null : current);
    };
    nav.addEventListener("wheel", onWheel, { passive: false });
    return () => nav.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!openId) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      const row = sourceRow(event.target);
      if (row?.dataset.sourceId !== openId || !list.current?.contains(row)) setOpenId(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [openId]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    if (!(event.target instanceof Element) || !event.target.closest(".source-item")) return;
    const row = sourceRow(event.target);
    const width = row?.querySelector<HTMLElement>(".source-actions")?.offsetWidth;
    if (!row || !width) return;
    drag.current = {
      row,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width,
      startOffset: row.dataset.sourceId === openId ? width : 0,
    };
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishDrag(event);
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.row.hasAttribute("data-dragging")) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) <= 1.25 * Math.abs(dy)) {
        drag.current = null;
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.row.setAttribute("data-dragging", "");
      suppressClick.current = true;
    }
    const offset = Math.min(gesture.width, Math.max(0, gesture.startOffset - dx));
    gesture.row.style.setProperty("--source-action-shift", `${gesture.width - offset}px`);
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drag.current = null;
    const dragging = gesture.row.hasAttribute("data-dragging");
    gesture.row.removeAttribute("data-dragging");
    gesture.row.style.removeProperty("--source-action-shift");
    if (!dragging || event.type !== "pointerup") return;
    const distance = gesture.x - event.clientX;
    if (distance >= swipeThreshold) setOpenId(gesture.row.dataset.sourceId ?? null);
    if (distance <= -swipeThreshold)
      setOpenId((current) => current === gesture.row.dataset.sourceId ? null : current);
  }

  function renderGroup(group: ReturnType<typeof groupSources>, depth: number): ReactNode {
    return <>
      {group.name && <h3 className="source-folder" style={{ paddingInlineStart: Math.min(depth, 4) * 8 + 7 }}>{group.name}</h3>}
      {group.sources.map((source) => {
        const opened = openId === source.id;
        const unread = unreadBySource.get(source.id) ?? 0;
        return (
          <div
            key={source.id}
            className="source-row"
            data-source-id={source.id}
            data-open={opened || undefined}
          >
            <button
              className={`nav-item source-item ${selectedId === source.id ? "source-active" : ""}`}
              aria-current={selectedId === source.id ? "page" : undefined}
              title={
                source.lastError || (source.lastSuccess && Number.isFinite(Date.parse(source.lastSuccess))
                  ? t("最近成功刷新：{0}", [new Date(source.lastSuccess).toLocaleString(locale)])
                  : undefined)
              }
              onClick={() => opened ? setOpenId(null) : onSelect(source.id)}
            >
              <RssSimpleIcon size={23} weight="bold" aria-hidden="true" />
              <span className="source-name" title={source.name}>{source.name}</span>
              {source.kind === "pending" && (
                <span className="pending-source" title={t("订阅地址已保存，点击刷新获取文章")}>
                  {t("待更新")}
                </span>
              )}
              {source.lastError && (
                <WarningCircleIcon className="source-error" size={16} aria-label={t("订阅更新失败")} />
              )}
              {unread > 0 && (
                <span className="nav-count source-count" aria-label={t("{0} 篇未读", [unread])}>{unread}</span>
              )}
            </button>
            <div className="source-actions" aria-hidden={!opened || undefined}>
              <button
                className="source-action"
                aria-label={t("编辑 {0}", [source.name])}
                title={t("编辑")}
                inert={!opened}
                onClick={() => { onEdit(source); setOpenId(null); }}
              >
                <PencilSimpleIcon size={18} aria-hidden="true" />
              </button>
              <button
                className="source-action"
                aria-label={t("上移 {0}", [source.name])}
                title={t("上移")}
                disabled={busy || !canReorderSource(sources, source.id, -1)}
                inert={!opened}
                onClick={() => { onMove(source, -1); setOpenId(null); }}
              >
                <ArrowUpIcon size={18} aria-hidden="true" />
              </button>
              <button
                className="source-action"
                aria-label={t("下移 {0}", [source.name])}
                title={t("下移")}
                disabled={busy || !canReorderSource(sources, source.id, 1)}
                inert={!opened}
                onClick={() => { onMove(source, 1); setOpenId(null); }}
              >
                <ArrowDownIcon size={18} aria-hidden="true" />
              </button>
              <button
                className="source-action source-remove"
                aria-label={t("取消订阅 {0}", [source.name])}
                title={t("取消订阅")}
                disabled={busy}
                inert={!opened}
                onClick={() => { onUnsubscribe(source); setOpenId(null); }}
              >
                <TrashIcon size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
      {[...group.groups.values()].map((child) => (
        <Fragment key={child.name}>{renderGroup(child, depth + 1)}</Fragment>
      ))}
    </>;
  }

  return (
    <nav
      ref={list}
      className="subscription-list"
      aria-label={t("订阅来源")}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !openId) return;
        event.stopPropagation();
        event.currentTarget.querySelector<HTMLButtonElement>("[data-open] .source-item")?.focus();
        setOpenId(null);
      }}
    >
      {renderGroup(groupSources(sources), 0)}
    </nav>
  );
}
