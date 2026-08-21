import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { MessagesProvider, en } from "../src/messages/index.js";
import {
  GiftsPortsProvider,
  UiProvider,
  type GiftsPorts,
} from "../src/web/index.js";
import { testAdapter } from "./support.js";

/**
 * A fake for the application's gift ports: every write resolves, unless a test
 * overrides it. Returned so a test can assert what the UI asked the application
 * to do.
 */
export function fakeGiftsPorts(over: Partial<GiftsPorts> = {}): GiftsPorts {
  return {
    capture: vi.fn(async () => {}),
    attachRecipient: vi.fn(async () => {}),
    setGiven: vi.fn(async () => {}),
    detachRecipient: vi.fn(async () => {}),
    ...over,
  };
}

/** Render a gift surface with both the UI adapter and the gift ports mounted. */
export function renderWithGifts(ui: ReactElement, ports: GiftsPorts) {
  return render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={testAdapter}>
        <GiftsPortsProvider ports={ports}>{ui}</GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>,
  );
}
