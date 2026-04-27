export interface CameraSnapshot {
  focusSeq: number;
  panOffset: number;
  zoomFactor: number;
  pxPerVerse: number;
  viewportW: number;
  sidebarW: number;
}

const bus = new EventTarget();

export function dispatchCameraUpdate(snap: CameraSnapshot): void {
  bus.dispatchEvent(new CustomEvent("camera", { detail: snap }));
}

export function subscribeCameraUpdate(
  cb: (snap: CameraSnapshot) => void,
): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<CameraSnapshot>).detail);
  bus.addEventListener("camera", handler);
  return () => bus.removeEventListener("camera", handler);
}

export function seqToWorld(seq: number, snap: CameraSnapshot): number {
  return (seq - snap.focusSeq) * snap.pxPerVerse + snap.viewportW / 2 + snap.panOffset;
}
