/** True when the browser exposes WebGPU, which the in-browser LLM needs. */
export function hasWebGpu(nav: Navigator = navigator): boolean {
  return typeof (nav as unknown as { gpu?: unknown }).gpu !== "undefined";
}
