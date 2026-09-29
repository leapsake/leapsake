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

/** Fake gift ports whose writes resolve unless a test overrides them. */
export function fakeGiftsPorts(over: Partial<GiftsPorts> = {}): GiftsPorts {
  return {
    capture: vi.fn(async () => {}),
    attachRecipient: vi.fn(async () => {}),
    setGiven: vi.fn(async () => {}),
    detachRecipient: vi.fn(async () => {}),
    ...over,
  };
}

/** Renders a gift surface with the UI adapter and the gift ports. */
export function renderWithGifts(ui: ReactElement, ports: GiftsPorts) {
  return render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={testAdapter}>
        <GiftsPortsProvider ports={ports}>{ui}</GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>,
  );
}
