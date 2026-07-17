"use client";

// Accessible modal shell: role="dialog" + aria-modal, focus moved in on open,
// Tab trapped within the panel, Escape to close, and focus restored to the
// trigger on close. Click-outside and the overlay also close it.

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Dialog({
  label,
  onClose,
  children,
  panelClassName = "max-w-3xl",
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
  panelClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const items = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    // Move focus into the dialog (first focusable, else the panel itself).
    (items()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement;
      const idx = list.indexOf(active);
      if (e.shiftKey && idx <= 0) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && idx === list.length - 1) {
        e.preventDefault();
        list[0].focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the dialog.
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`card w-full p-6 outline-none ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
