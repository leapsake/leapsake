import { describe, expect, it } from "vitest";

import { anrWaitTap } from "./mobile-harness.mjs";

// Trimmed from the dump a hosted Android runner produced on 2026-09-19.
const ANR_DUMP =
  '<hierarchy rotation="0">' +
  '<node index="0" text="System UI isn\'t responding" resource-id="android:id/alertTitle" class="android.widget.TextView" bounds="[80,900][1000,980]" />' +
  '<node index="1" text="Close app" resource-id="android:id/aerr_close" class="android.widget.Button" bounds="[80,1000][1000,1120]" />' +
  '<node index="2" text="Wait" resource-id="android:id/aerr_wait" class="android.widget.Button" bounds="[80,1120][1000,1240]" />' +
  "</hierarchy>";

describe("anrWaitTap", () => {
  it("finds the centre of the Wait button and the dialog's title", () => {
    expect(anrWaitTap(ANR_DUMP)).toEqual({
      x: "540",
      y: "1180",
      title: "System UI isn't responding",
    });
  });

  it("returns null when no dialog is on screen", () => {
    expect(
      anrWaitTap(
        '<hierarchy><node text="" resource-id="tab-search" bounds="[0,0][100,100]" /></hierarchy>',
      ),
    ).toBeNull();
  });

  it("never taps Close app", () => {
    expect(
      anrWaitTap(ANR_DUMP.replace(/<node[^>]*aerr_wait[^>]*\/>/, "")),
    ).toBeNull();
  });
});
