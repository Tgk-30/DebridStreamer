import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface ErrorNoteProps
  extends Omit<ComponentPropsWithoutRef<"p">, "children" | "role"> {
  children: ReactNode;
  as?: "p" | "div";
}

/** A visually-neutral live region for errors surfaced in existing screen UI. */
export function ErrorNote({ as: Tag = "p", children, ...props }: ErrorNoteProps) {
  return (
    <Tag {...props} role="alert">
      {children}
    </Tag>
  );
}
