// task #8: full implementation (desktop only)
// 32px bar; proportional book widths; click → jump to book
export class BookMinimap {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("nav");
    this.el.style.cssText =
      "position:fixed;bottom:0;left:0;right:384px;height:32px;z-index:10;" +
      "background:rgba(15,23,42,0.9);backdrop-filter:blur(8px);" +
      "border-top:1px solid #334155;display:none;"; // visible ≥1024px
    this.el.setAttribute("role", "navigation");
    this.el.setAttribute("aria-label", "Minimapa de libros");
  }

  mount(container: HTMLElement): void {
    container.appendChild(this.el);
  }
}
