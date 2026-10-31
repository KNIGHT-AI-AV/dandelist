import { appendFileSync } from "node:fs";
import { ReleaseControl } from "../control.mjs";

// Temporary-fixture coordination only; this worker imports no provider, credential or SDK.
const send = (message) => process.send?.(message);
let release;
const released = new Promise((resolve) => { release = resolve; });
process.on("message", (message) => { if (message.type === "release") release(); });
process.once("message", async (spec) => {
  try {
    const control = new ReleaseControl(spec.config);
    send({ type: "starting", cwd: process.cwd() });
    const value = spec.action === "retire"
      ? await control.retireUndeployed(spec.input)
      : await control.submit(spec.input, async (request) => {
        appendFileSync(spec.trace, JSON.stringify(request) + "\n");
        send({ type: "entered" });
        await released;
        return { id: "fixture-deploy-race" };
      });
    process.send({ type: "result", ok: true, value }, () => process.disconnect());
  } catch (error) {
    process.send({ type: "result", ok: false, message: String(error?.message ?? error) }, () => process.disconnect());
  }
});
send({ type: "ready" });
