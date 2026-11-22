import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AppServices } from "../src/app/AppServices";
import { Emitter } from "../src/lib/Emitter";
import { prefetchLive, ServicesProvider, useLiveState } from "../src/ui/ServicesContext";

/*
 * What a screen sees on its first render (server rendering runs no effects, so no load of its
 * own): only what the cache holds for its key, and whether that copy is fresh.
 */
function firstRender(changes: Emitter, deps: readonly unknown[], cacheAs = "probe"): { value: unknown; fresh: boolean } {
  function Probe() {
    const live = useLiveState(() => new Promise<never>(() => {}), deps, cacheAs);
    return createElement("output", null, JSON.stringify({ value: live.value ?? null, fresh: live.fresh }));
  }
  const services = { changes } as unknown as AppServices;
  const html = renderToString(createElement(ServicesProvider, { services, children: createElement(Probe) }));
  return JSON.parse(html.replace(/^<output>|<\/output>$/g, "").replace(/&quot;/g, '"')) as { value: unknown; fresh: boolean };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("live cache", () => {
  it("draws what was loaded ahead under the same key, at once", async () => {
    const changes = new Emitter();
    await prefetchLive({ changes }, "probe", ["2026-11-09", "2026-11-20"], async () => 42);
    expect(firstRender(changes, ["2026-11-09", "2026-11-20"])).toEqual({ value: 42, fresh: true });
    expect(firstRender(changes, ["2026-11-16", "2026-11-20"])).toEqual({ value: null, fresh: false });
    expect(firstRender(changes, ["2026-11-09", "2026-11-20"], "other")).toEqual({ value: null, fresh: false });
  });

  it("keeps showing a copy from before a data change, but no longer calls it fresh", async () => {
    const changes = new Emitter();
    await prefetchLive({ changes }, "probe", [], async () => []);
    changes.emit();
    expect(firstRender(changes, [])).toEqual({ value: [], fresh: false });
    await prefetchLive({ changes }, "probe", [], async () => ["Upper 1"]);
    expect(firstRender(changes, [])).toEqual({ value: ["Upper 1"], fresh: true });
  });

  it("counts a copy as stale when the change came while it was loading", async () => {
    const changes = new Emitter();
    const load = deferred<string>();
    const done = prefetchLive({ changes }, "probe", [], () => load.promise);
    changes.emit();
    load.resolve("read before the change");
    await done;
    expect(firstRender(changes, [])).toEqual({ value: "read before the change", fresh: false });
  });

  it("never lets an older load replace a newer copy", async () => {
    const changes = new Emitter();
    const slow = deferred<string>();
    const old = prefetchLive({ changes }, "probe", [], () => slow.promise);
    changes.emit();
    await prefetchLive({ changes }, "probe", [], async () => "new");
    slow.resolve("old");
    await old;
    expect(firstRender(changes, [])).toEqual({ value: "new", fresh: true });
  });

  it("loads ahead only what isn't fresh or on its way already", async () => {
    const changes = new Emitter();
    let loads = 0;
    const load = async () => ++loads;
    await Promise.all([prefetchLive({ changes }, "probe", [], load), prefetchLive({ changes }, "probe", [], load)]);
    await prefetchLive({ changes }, "probe", [], load);
    expect(loads).toBe(1);
    changes.emit();
    await prefetchLive({ changes }, "probe", [], load);
    expect(loads).toBe(2);
    expect(firstRender(changes, [])).toEqual({ value: 2, fresh: true });
  });

  it("keeps one cache per set of services", async () => {
    const mine = new Emitter();
    await prefetchLive({ changes: mine }, "probe", [], async () => "mine");
    expect(firstRender(new Emitter(), [])).toEqual({ value: null, fresh: false });
  });
});
