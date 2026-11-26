import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type ColumnResizerProps = {
  label: string;
  className: string;
  min: number;
  max: number;
  readerMin: number;
  measure: () => number;
  measureOther: () => number;
  value?: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
};

const KEY_STEP = 16;

export function ColumnResizer({
  label,
  className,
  min,
  max,
  readerMin,
  measure,
  measureOther,
  value,
  onChange,
  onCommit,
}: ColumnResizerProps) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const latest = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  const clamp = (width: number) => {
    const other = measureOther();
    const viewportLimit = Math.max(min, window.innerWidth - other - readerMin);
    return Math.round(Math.min(Math.max(width, min), Math.min(max, viewportLimit)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = measure() || value || min;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth };
    latest.current = startWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("column-resizing");
    setActive(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const next = clamp(drag.current.startWidth + event.clientX - drag.current.startX);
    latest.current = next;
    onChange(next);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setActive(false);
    document.body.classList.remove("column-resizing");
    const finalWidth = latest.current;
    latest.current = null;
    if (commit && finalWidth != null) onCommit(finalWidth);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = measure() || value || min;
    let next = current;
    switch (event.key) {
      case "ArrowLeft":
        next = current - KEY_STEP;
        break;
      case "ArrowRight":
        next = current + KEY_STEP;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    next = clamp(next);
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-active={active || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onKeyDown={handleKeyDown}
    />
  );
}
