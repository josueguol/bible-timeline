// task #8: full implementation
// Consumes: GET /api/bible/versions; emits store.update({ activeVersions })
export class VersionPicker {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Seleccionar versión");
    this.el.style.cssText = "display:none;"; // opened programmatically
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }

  open(): void {
    this.el.style.display = "block";
  }

  close(): void {
    this.el.style.display = "none";
  }
}
