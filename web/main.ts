import { Controller } from "./controller.js";
import { mount } from "./views.js";
let controller: Controller | undefined, unmount: (() => void) | undefined;
function start() {
  const available =
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof ReadableStream !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    /^https?:$/.test(location.protocol);
  controller = new Controller(
    {
      import: new URL("./import.worker.js", import.meta.url),
      export: new URL("./export.worker.js", import.meta.url),
      preview: new URL("./preview.worker.js", import.meta.url),
    },
    undefined,
    available,
  );
  unmount = mount(controller);
}
function dispose() {
  unmount?.();
  unmount = undefined;
  controller?.dispose();
  controller = undefined;
}
window.addEventListener("pagehide", dispose);
window.addEventListener("pageshow", () => {
  if (!controller) start();
});
start();
