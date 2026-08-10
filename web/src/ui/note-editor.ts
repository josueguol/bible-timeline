import { createNote, updateNote, type NoteDto, NotesApiError } from "@api/notes.ts";
import { renderMarkdown } from "@ui/markdown.ts";

export class NoteEditor {
  readonly el: HTMLElement;
  private textarea!: HTMLTextAreaElement;
  private preview!: HTMLElement;
  private errorEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private previewMode = false;

  constructor(
    private readonly verseRef: string,
    private readonly verseLabel: string,
    private readonly existingNote: NoteDto | null,
    private readonly onSaved: (note: NoteDto) => void,
    private readonly onClose: () => void,
  ) {
    this.el = document.createElement("div");
    this.el.role = "dialog";
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", existingNote ? "Editar nota" : "Nueva nota");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;inset:0;z-index:200;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);";
    this.render();
  }

  private render(): void {
    this.el.innerHTML = "";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:var(--color-bg-deep);border:1px solid var(--color-border);" +
      "border-radius:12px;width:min(680px,95vw);max-height:90vh;" +
      "display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.4);";

    // ── Header ────────────────────────────────────────────────
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:16px 20px;border-bottom:1px solid var(--color-border);flex-shrink:0;";

    const title = document.createElement("div");
    title.style.cssText = "display:flex;flex-direction:column;gap:2px;";

    const titleMain = document.createElement("span");
    titleMain.style.cssText = "font-size:1rem;font-weight:600;color:var(--color-text-primary);";
    titleMain.textContent = this.existingNote ? "Editar nota" : "Nueva nota";

    const titleSub = document.createElement("span");
    titleSub.style.cssText = "font-size:.8rem;color:var(--color-text-secondary);";
    titleSub.textContent = this.verseLabel;

    title.append(titleMain, titleSub);

    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Cerrar editor");
    closeBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:1.4rem;" +
      "color:var(--color-text-secondary);padding:4px;line-height:1;";
    closeBtn.textContent = "×";
    closeBtn.onclick = () => this.onClose();

    header.append(title, closeBtn);

    // ── Toolbar ───────────────────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "display:flex;gap:8px;padding:10px 20px;border-bottom:1px solid var(--color-border);" +
      "flex-shrink:0;";

    const editBtn = this.makeToolbarBtn("Editar", !this.previewMode);
    const previewBtn = this.makeToolbarBtn("Vista previa", this.previewMode);

    editBtn.onclick = () => { this.previewMode = false; this.refresh(); };
    previewBtn.onclick = () => { this.previewMode = true; this.refresh(); };

    const hint = document.createElement("span");
    hint.style.cssText =
      "margin-left:auto;font-size:.75rem;color:var(--color-text-secondary);align-self:center;";
    hint.textContent = "Markdown • pega código embed de YouTube, Twitter, Instagram…";

    toolbar.append(editBtn, previewBtn, hint);

    // ── Body ──────────────────────────────────────────────────
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow:auto;padding:0;";

    this.textarea = document.createElement("textarea");
    this.textarea.setAttribute("aria-label", "Contenido de la nota en Markdown");
    this.textarea.placeholder =
      "Escribe tu nota en Markdown…\n\nPuedes pegar el código embed de YouTube, Twitter, Instagram, Facebook o TikTok directamente.";
    this.textarea.value = this.existingNote?.content ?? "";
    this.textarea.style.cssText =
      "width:100%;box-sizing:border-box;height:320px;min-height:200px;" +
      "padding:16px 20px;border:none;background:var(--color-bg-mid);" +
      "color:var(--color-text-primary);font-family:monospace;font-size:.9rem;" +
      "resize:vertical;outline:none;";
    this.textarea.style.display = this.previewMode ? "none" : "";

    this.preview = document.createElement("div");
    this.preview.style.cssText =
      "padding:16px 20px;min-height:320px;font-size:.9rem;" +
      "color:var(--color-text-primary);line-height:1.6;";
    this.preview.style.display = this.previewMode ? "" : "none";
    if (this.previewMode) {
      this.preview.innerHTML = renderMarkdown(this.textarea.value || "*(sin contenido)*");
    }

    body.append(this.textarea, this.preview);

    // ── Footer ────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText =
      "display:flex;align-items:center;gap:10px;padding:14px 20px;" +
      "border-top:1px solid var(--color-border);flex-shrink:0;";

    this.errorEl = document.createElement("span");
    this.errorEl.role = "alert";
    this.errorEl.style.cssText =
      "flex:1;font-size:.85rem;color:var(--color-accent-error,#e05);";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancelar";
    cancelBtn.style.cssText =
      "padding:8px 16px;border:1px solid var(--color-border);border-radius:8px;" +
      "background:transparent;color:var(--color-text-primary);cursor:pointer;font-size:.9rem;";
    cancelBtn.onclick = () => this.onClose();

    this.saveBtn = document.createElement("button");
    this.saveBtn.type = "button";
    this.saveBtn.textContent = "Guardar";
    this.saveBtn.style.cssText =
      "padding:8px 20px;border:none;border-radius:8px;" +
      "background:var(--color-accent-primary);color:#fff;" +
      "cursor:pointer;font-size:.9rem;font-weight:600;";
    this.saveBtn.onclick = () => void this.save();

    footer.append(this.errorEl, cancelBtn, this.saveBtn);

    panel.append(header, toolbar, body, footer);
    this.el.appendChild(panel);

    this.el.onclick = (e) => { if (e.target === this.el) this.onClose(); };
    this.el.onkeydown = (e) => { if (e.key === "Escape") this.onClose(); };
  }

  private makeToolbarBtn(label: string, active: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText =
      "padding:4px 12px;border-radius:6px;font-size:.85rem;cursor:pointer;" +
      `border:1px solid ${active ? "var(--color-accent-primary)" : "var(--color-border)"};` +
      `background:${active ? "var(--color-accent-primary)" : "transparent"};` +
      `color:${active ? "#fff" : "var(--color-text-secondary)"};`;
    return btn;
  }

  private refresh(): void {
    // Preserve current text before re-rendering
    const current = this.textarea.value;
    this.render();
    this.textarea.value = current;
    if (this.previewMode) {
      this.preview.innerHTML = renderMarkdown(current || "*(sin contenido)*");
    }
  }

  private async save(): Promise<void> {
    this.errorEl.textContent = "";
    const content = this.textarea.value.trim();
    if (!content) {
      this.errorEl.textContent = "La nota no puede estar vacía";
      return;
    }
    if (content.length > 10_000) {
      this.errorEl.textContent = `Límite de 10,000 caracteres (actual: ${content.length})`;
      return;
    }

    this.saveBtn.disabled = true;
    try {
      const note = this.existingNote
        ? await updateNote(this.existingNote.id, content)
        : await createNote(this.verseRef, content);
      this.onSaved(note);
      this.onClose();
    } catch (err) {
      if (err instanceof NotesApiError) {
        this.errorEl.textContent =
          err.status === 401 ? "Sesión expirada. Vuelve a iniciar sesión." : err.message;
      } else {
        this.errorEl.textContent = "Error de red. Intenta de nuevo.";
      }
    } finally {
      this.saveBtn.disabled = false;
    }
  }

  mount(): void {
    document.body.appendChild(this.el);
    this.textarea.focus();
  }

  unmount(): void {
    this.el.remove();
  }
}
