import { describe, expect, it } from "vitest";
import {
  type DesiredNotification,
  type NotificationScheduler,
  type PendingNotification,
  reconcile,
} from "../src/index.js";

/** An in-memory scheduler recording every call, for asserting the delta. */
function fakeScheduler(): {
  scheduler: NotificationScheduler;
  scheduled: string[];
  cancelled: string[];
} {
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  return {
    scheduled,
    cancelled,
    scheduler: {
      schedule: async (n: DesiredNotification) => {
        scheduled.push(n.id);
      },
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
  };
}

const ENTRY: DesiredNotification = {
  id: "a",
  fireAt: 1,
  title: "t",
  body: "b",
  reminderId: null,
};

describe("reconcile", () => {
  it("schedules a desired entry absent from pending", async () => {
    const { scheduler, scheduled, cancelled } = fakeScheduler();

    const result = await reconcile([ENTRY], [], scheduler);

    expect(scheduled).toEqual(["a"]);
    expect(cancelled).toEqual([]);
    expect(result).toEqual({ scheduled: 1, cancelled: 0 });
  });

  it("leaves an unchanged entry alone", async () => {
    const { scheduler, scheduled, cancelled } = fakeScheduler();
    const pending: PendingNotification[] = [
      { id: "a", fireAt: 1, title: "t", body: "b" },
    ];

    const result = await reconcile([ENTRY], pending, scheduler);

    expect(scheduled).toEqual([]);
    expect(cancelled).toEqual([]);
    expect(result).toEqual({ scheduled: 0, cancelled: 0 });
  });

  it("cancels and re-schedules an entry whose content drifted", async () => {
    const { scheduler, scheduled, cancelled } = fakeScheduler();
    const pending: PendingNotification[] = [
      { id: "a", fireAt: 1, title: "stale title", body: "b" },
    ];

    const result = await reconcile([ENTRY], pending, scheduler);

    expect(cancelled).toEqual(["a"]);
    expect(scheduled).toEqual(["a"]);
    expect(result).toEqual({ scheduled: 1, cancelled: 1 });
  });

  it("cancels a pending entry no longer desired", async () => {
    const { scheduler, scheduled, cancelled } = fakeScheduler();
    const pending: PendingNotification[] = [
      { id: "stale", fireAt: 1, title: "t", body: "b" },
    ];

    const result = await reconcile([], pending, scheduler);

    expect(cancelled).toEqual(["stale"]);
    expect(scheduled).toEqual([]);
    expect(result).toEqual({ scheduled: 0, cancelled: 1 });
  });
});
