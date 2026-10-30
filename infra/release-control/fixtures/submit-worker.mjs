import { appendFileSync } from "node:fs";
import { ReleaseControl } from "../control.mjs";

// This worker has no provider/client dependency. Its only submission is an append to a fixture trace.
const send = (value) => process.send?.(value);
process.once("message", async (spec) => {
  try {
    const control = new ReleaseControl(spec.config);
    send({ type: "starting", cwd: process.cwd() });
    const value = spec.action === "begin"
      ? await control.begin(spec.input)
      : await control.submit(spec.input, async (request) => {
        appendFileSync(spec.trace, JSON.stringify({ ...request, cwd: process.cwd() }) + "\n");
        send({ type: "entered" });
        await new Promise((resolve) => process.once("message", resolve));
        return { id: "build-shared" };
      });
    process.send({ type: "result", ok: true, value }, () => process.disconnect());
  } catch (error) {
    process.send({ type: "result", ok: false, message: String(error?.message ?? error) }, () => process.disconnect());
  }
});
send({ type: "ready" });
