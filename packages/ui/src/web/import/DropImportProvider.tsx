import {
  type ParsedContact,
  detectContactFormat,
  parseVCards,
} from "@leapsake/vcard";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMessages } from "../../messages/index.js";
import styles from "./ImportOverlay.module.css";
import {
  ImportReview,
  type ImportDecision,
  type ImportOutcome,
  type ImportPreviewEntry,
} from "./ImportReview.js";

// A window-wide drop target for contact files, parsed here; nothing is written
// until the review is confirmed, and an unrecognised file gets a notice.

type ImportState =
  | { kind: "idle" }
  | { kind: "reviewing"; contacts: ParsedContact[] }
  | { kind: "unrecognized"; filename: string };

/** Whether a drag carries files rather than text, the only drags taken. */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function DropImportProvider({
  onPreview,
  onCommit,
  onDone,
  onPickSelf,
  children,
}: {
  onPreview: (
    contacts: readonly ParsedContact[],
  ) => Promise<ImportPreviewEntry[]>;
  onCommit: (decisions: ImportDecision[]) => Promise<ImportOutcome>;
  onDone: (outcome: ImportOutcome) => void;
  onPickSelf: () => void;
  children: ReactNode;
}) {
  const m = useMessages();
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  // Enter/leave fire per descendant element, so count depth to avoid the hint
  // flickering as the cursor crosses child nodes.
  const dragDepth = useRef(0);

  useEffect(() => {
    // Without preventDefault on dragover and drop, Chromium navigates to the
    // dropped file:// URL and tears the app down.
    const onDragOver = (e: DragEvent) => {
      if (dragHasFiles(e)) e.preventDefault();
    };
    const onDragEnter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        const detected = detectContactFormat({ text, filename: file.name });
        if (detected.format !== "vcard") {
          setState({ kind: "unrecognized", filename: file.name });
          return;
        }
        const contacts = parseVCards(text);
        if (contacts.length === 0) {
          setState({ kind: "unrecognized", filename: file.name });
          return;
        }
        setState({ kind: "reviewing", contacts });
      });
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const close = () => setState({ kind: "idle" });

  return (
    <>
      {children}
      {dragging && <div className={styles.dropHint}>{m.import.dropHint}</div>}
      {state.kind === "reviewing" && (
        <ImportReview
          contacts={state.contacts}
          onPreview={onPreview}
          onCommit={onCommit}
          onClose={close}
          onDone={(outcome) => {
            close();
            onDone(outcome);
          }}
          onPickSelf={() => {
            close();
            onPickSelf();
          }}
        />
      )}
      {state.kind === "unrecognized" && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={`${styles.dialog} ${styles.notice}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{m.import.unrecognizedHeading}</h2>
            <p>{m.import.unrecognizedBody(state.filename)}</p>
            <div className={styles.actions}>
              <button type="button" onClick={close}>
                {m.import.acknowledge}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
