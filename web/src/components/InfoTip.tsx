import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import "./InfoTip.css";

interface InfoTipPosition {
  top: number;
  left: number;
  placement: "above" | "below";
}

/** Compact, keyboard-accessible help for an otherwise dense settings control. */
export function InfoTip({
  children,
  label = "More information",
}: {
  children: ReactNode;
  label?: string;
}) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<InfoTipPosition | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const close = () => {
    clearCloseTimer();
    setOpen(false);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 80);
  };

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect == null) return;
    const estimatedHeight = 156;
    const horizontalInset = Math.min(162, window.innerWidth / 2);
    const placement =
      rect.bottom + 8 + estimatedHeight > window.innerHeight && rect.top > estimatedHeight
        ? "above"
        : "below";
    setPosition({
      top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(
        Math.max(rect.left + rect.width / 2, horizontalInset),
        window.innerWidth - horizontalInset,
      ),
      placement,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [],
  );

  const tooltip =
    open && position != null && typeof document !== "undefined"
      ? createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className={`info-tip__content is-${position.placement}`}
            style={{ top: position.top, left: position.left }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="info-tip">
      <button
        ref={triggerRef}
        type="button"
        className="info-tip__trigger"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onMouseEnter={() => {
          clearCloseTimer();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <Icon name="info" size={14} />
      </button>
      {tooltip}
    </span>
  );
}
