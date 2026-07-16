import {
  type ParsedContact,
  detectContactFormat,
  parseVCards,
} from "@leapsake/contact-import";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./ImportOverlay.module.css";
import { ImportReview } from "./ImportReview";

/**
 * The desktop contact-import entry point: a window-wide drag-and-drop target so a
 * contact file can be dropped **on any screen, at any time**. It reads the dropped
 * file in the renderer (HTML5 drop hands us a real `File`), detects and parses it
 * with the pure `@leapsake/contact-import` package — no IPC yet — and opens the
 * review modal; only the reviewed commit crosses to the main process. A dropped
 * file that isn't a recognised contact card gets a friendly notice rather than a
 * silent no-op (the "recognise it / ask if unsure" requirement); the discriminated
 * parse result is the seam where more formats slot in later.
 */

type ImportState =
  | { kind: "idle" }
  | { kind: "reviewing"; contacts: ParsedContact[] }
  | { kind: "unrecognized"; filename: string };

/** Whether a drag carries files (vs. text/selection), so we only intercept files. */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function DropImportProvider({ children }: { children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  // Enter/leave fire per descendant element, so count depth to avoid the hint
  // flickering as the cursor crosses child nodes.
  const dragDepth = useRef(0);

  useEffect(() => {
    // Without preventDefault on dragover+drop, Chromium/Electron navigates the
    // window to the dropped file:// URL and tears down the SPA — this is the
    // load-bearing line of the whole feature.
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
      {dragging && (
        <div className={styles.dropHint}>
          Drop a contact card (.vcf) to import
        </div>
      )}
      {state.kind === "reviewing" && (
        <ImportReview contacts={state.contacts} onClose={close} />
      )}
      {state.kind === "unrecognized" && (
        <div className={styles.backdrop} onClick={close}>
          <div
            className={`${styles.dialog} ${styles.notice}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Can’t read that file</h2>
            <p>
              Leapsake can only import contact cards (<code>.vcf</code>) right
              now, and <strong>{state.filename}</strong> doesn’t look like one.
            </p>
            <div className={styles.actions}>
              <button type="button" onClick={close}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
