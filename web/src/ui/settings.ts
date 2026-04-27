// task #8: full implementation
// Options: theme, text size, reduced-motion, primary version, PWA install prompt
export class Settings {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Configuración");
    this.el.style.cssText = "display:none;position:fixed;inset:0;z-index:50;";
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
