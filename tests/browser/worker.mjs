import { run } from "./contract.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: run(data) });
  } catch (e) {
    self.postMessage({ error: String(e.stack ?? e) });
  }
};
