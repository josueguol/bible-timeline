import { store } from "@store/app-store.ts";
import { authStore } from "@store/auth-store.ts";
import {
  fetchNotes,
  deleteNote,
  type NoteDto,
  NotesApiError,
} from "@api/notes.ts";
import { renderMarkdown } from "@ui/markdown.ts";
import { AuthModal, logout } from "@ui/auth-modal.ts";
import { NoteEditor } from "@ui/note-editor.ts";

const VERSE_ZOOM_LABEL = "Versículos";

export class NotePanel {
  readonly el: HTMLElement;
  private notes: NoteDto[] = [];
  private loading = false;
  private currentRef: string | null = null;
  private abortController: AbortController | null = null;
  private authModal: AuthModal | null = null;
  private noteEditor: NoteEditor | null = null;

  constructor() {
    this.el = document.createElement("aside");
    this.el.setAttribute("aria-label", "Notas del versículo");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;right:0;top:50%;transform:translateY(-50%);" +
      "width:min(320px,90vw);max-height:70vh;" +
      "background:var(--color-bg-deep);border:1px solid var(--color-border);" +
      "border-radius:12px 0 0 12px;overflow:hidden;" +
      "display:flex;flex-direction:column;" +
      "box-shadow:-4px 0 20px rgba(0,0,0,.25);z-index:25;";

    store.subscribe((state) => {
      const inVerseMode =
        state.viewport?.zoomLevel.label === VERSE_ZOOM_LABEL;
      const ref = state.focusRef;

      if (!inVerseMode || !ref) {
        this.hide();
        return;
      }
      if (!state.showFloats || !state.floatTypes.includes("note")) {
        this.hide();
        return;
      }

      this.show(ref);
    });

    authStore.subscribe(() => {
      if (this.currentRef) this.loadNotes(this.currentRef);
    });
  }

  private show(ref: string): void {
    if (!this.el.isConnected) document.body.appendChild(this.el);
    if (ref !== this.currentRef) {
      this.currentRef = ref;
      void this.loadNotes(ref);
    }
  }

  private hide(): void {
    this.abortController?.abort();
    this.el.remove();
    this.currentRef = null;
  }

  private async loadNotes(ref: string): Promise<void> {
    this.abortController?.abort();

    if (!authStore.isAuthenticated()) {
      this.notes = [];
      this.renderPanel(ref);
      return;
    }

    this.abortController = new AbortController();
    this.loading = true;
    this.renderPanel(ref);

    try {
      const result = await fetchNotes(ref, this.abortController.signal);
      this.notes = result.notes;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      this.notes = [];
    } finally {
      this.loading = false;
    }
    this.renderPanel(ref);
  }

  private renderPanel(ref: string): void {
    this.el.innerHTML = "";

    // ── Header ────────────────────────────────────────────────
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:12px 14px;border-bottom:1px solid var(--color-border);flex-shrink:0;";

    const titleEl = document.createElement("span");
    titleEl.style.cssText =
      "font-size:.85rem;font-weight:600;color:var(--color-text-secondary);";
    titleEl.textContent = `Notas · ${ref}`;

    const authBtn = document.createElement("button");
    authBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:.75rem;" +
      "color:var(--color-text-secondary);padding:2px 6px;";

    if (authStore.isAuthenticated()) {
      const email = authStore.getState().user?.email ?? "";
      authBtn.textContent = `${email} · Salir`;
      authBtn.onclick = () => { logout(); };
    } else {
      authBtn.textContent = "Iniciar sesión";
      authBtn.onclick = () => this.openAuthModal();
    }

    header.append(titleEl, authBtn);

    // ── Body ──────────────────────────────────────────────────
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow-y:auto;padding:10px 14px;";

    if (this.loading) {
      const spin = document.createElement("p");
      spin.style.cssText =
        "font-size:.85rem;color:var(--color-text-secondary);text-align:center;margin:24px 0;";
      spin.textContent = "Cargando…";
      body.appendChild(spin);
    } else if (!authStore.isAuthenticated()) {
      const prompt = document.createElement("p");
      prompt.style.cssText =
        "font-size:.85rem;color:var(--color-text-secondary);text-align:center;margin:24px 0;";
      prompt.textContent = "Inicia sesión para ver y crear notas en este versículo.";
      body.appendChild(prompt);
    } else if (this.notes.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText =
        "font-size:.85rem;color:var(--color-text-secondary);text-align:center;margin:24px 0;";
      empty.textContent = "Sin notas para este versículo.";
      body.appendChild(empty);
    } else {
      for (const note of this.notes) {
        body.appendChild(this.renderNote(note, ref));
      }
    }

    // ── Footer (add note button) ──────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText =
      "padding:10px 14px;border-top:1px solid var(--color-border);flex-shrink:0;";

    if (authStore.isAuthenticated()) {
      const addBtn = document.createElement("button");
      addBtn.style.cssText =
        "width:100%;padding:8px;border:1px dashed var(--color-border);" +
        "border-radius:8px;background:transparent;" +
        "color:var(--color-text-secondary);cursor:pointer;font-size:.85rem;";
      addBtn.textContent = "+ Nueva nota";
      addBtn.onclick = () => this.openEditor(null, ref);
      footer.appendChild(addBtn);
    }

    this.el.append(header, body, footer);
  }

  private renderNote(note: NoteDto, ref: string): HTMLElement {
    const card = document.createElement("article");
    card.style.cssText =
      "border:1px solid var(--color-border);border-radius:8px;" +
      "padding:10px 12px;margin-bottom:10px;background:var(--color-bg-mid);";

    const content = document.createElement("div");
    content.style.cssText = "font-size:.82rem;line-height:1.6;color:var(--color-text-primary);";
    content.innerHTML = renderMarkdown(note.content);

    const meta = document.createElement("div");
    meta.style.cssText =
      "display:flex;justify-content:flex-end;gap:8px;margin-top:8px;";

    const date = document.createElement("time");
    date.dateTime = note.updatedAt;
    date.style.cssText = "font-size:.72rem;color:var(--color-text-secondary);flex:1;";
    date.textContent = new Date(note.updatedAt).toLocaleDateString("es", {
      year: "numeric", month: "short", day: "numeric",
    });

    const editBtn = this.makeIconBtn("✏️", "Editar nota");
    editBtn.onclick = () => this.openEditor(note, ref);

    const delBtn = this.makeIconBtn("🗑️", "Eliminar nota");
    delBtn.onclick = () => void this.confirmDelete(note, ref);

    meta.append(date, editBtn, delBtn);
    card.append(content, meta);
    return card;
  }

  private makeIconBtn(icon: string, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", label);
    btn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:.9rem;padding:2px 4px;";
    btn.textContent = icon;
    return btn;
  }

  private openAuthModal(): void {
    this.authModal?.el.remove();
    this.authModal = new AuthModal();
    this.authModal.open();
  }

  private openEditor(note: NoteDto | null, ref: string): void {
    this.noteEditor?.unmount();
    const appState = store.getState();
    const label = appState.focusRef ?? ref;

    this.noteEditor = new NoteEditor(
      ref,
      label,
      note,
      (saved) => {
        if (note) {
          this.notes = this.notes.map((n) => (n.id === saved.id ? saved : n));
        } else {
          this.notes = [...this.notes, saved];
        }
        this.renderPanel(ref);
      },
      () => {
        this.noteEditor?.unmount();
        this.noteEditor = null;
      },
    );
    this.noteEditor.mount();
  }

  private async confirmDelete(note: NoteDto, ref: string): Promise<void> {
    if (!confirm("¿Eliminar esta nota? Esta acción no se puede deshacer.")) return;
    try {
      await deleteNote(note.id);
      this.notes = this.notes.filter((n) => n.id !== note.id);
      this.renderPanel(ref);
    } catch (err) {
      if (err instanceof NotesApiError && err.status === 401) {
        authStore.clear();
      }
    }
  }
}
