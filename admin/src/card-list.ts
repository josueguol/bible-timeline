import type { FloatCard, FloatType } from "./api.ts";
import { listFloats, deleteFloat, publishFloat, logout, changePassword } from "./api.ts";

const TYPE_LABELS: Record<FloatType, string> = {
  context:  "Contexto",
  prophecy: "Profecía",
  xref:     "Ref. Cruz.",
  note:     "Nota",
  map:      "Mapa",
  people:   "Personaje",
};

export interface ListCallbacks {
  onNew:  () => void;
  onEdit: (card: FloatCard) => void;
}

export async function renderCardList(
  container: HTMLElement,
  cbs: ListCallbacks,
): Promise<void> {
  container.innerHTML = `
    <div class="list-header">
      <div class="list-header-left">
        <h1 class="app-title">Bible Timeline · Admin</h1>
        <div class="type-filters" id="type-filters">
          <button class="filter-btn active" data-type="">Todos</button>
          ${(Object.keys(TYPE_LABELS) as FloatType[]).map((t) =>
            `<button class="filter-btn" data-type="${t}">${TYPE_LABELS[t]}</button>`
          ).join("")}
        </div>
      </div>
      <div class="list-header-right">
        <button id="btn-new" class="btn btn-primary">+ Nueva card</button>
        <button id="btn-pwd" class="btn btn-ghost" title="Cambiar contraseña">🔑</button>
        <button id="btn-logout" class="btn btn-ghost">Salir</button>
      </div>
    </div>
    <div id="list-status" class="list-status">Cargando…</div>
    <div id="list-body"></div>
  `;

  const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel)!;

  q("#btn-new").addEventListener("click", cbs.onNew);
  q("#btn-logout").addEventListener("click", async () => {
    await logout();
    window.location.reload();
  });

  q("#btn-pwd").addEventListener("click", async () => {
    const cur = prompt("Contraseña actual:");
    if (!cur) return;
    const next = prompt("Nueva contraseña (mín. 8 caracteres):");
    if (!next || next.length < 8) { alert("Contraseña muy corta."); return; }
    const confirm = prompt("Confirmar nueva contraseña:");
    if (next !== confirm) { alert("Las contraseñas no coinciden."); return; }
    try {
      await changePassword(cur, next);
      alert("Contraseña actualizada.");
    } catch (err) {
      alert(`Error: ${String(err)}`);
    }
  });

  let activeType: string = "";

  q("#type-filters").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-btn");
    if (!btn) return;
    activeType = btn.dataset.type ?? "";
    for (const b of q("#type-filters").querySelectorAll(".filter-btn"))
      b.classList.toggle("active", b === btn);
    void refresh();
  });

  const refresh = async () => {
    const statusEl = q("#list-status");
    const bodyEl   = q("#list-body");
    statusEl.textContent = "Cargando…";
    statusEl.style.display = "block";
    bodyEl.innerHTML = "";

    let cards: FloatCard[];
    try {
      cards = await listFloats();
    } catch (err) {
      statusEl.textContent = `Error: ${String(err)}`;
      return;
    }

    const filtered = activeType ? cards.filter((c) => c.type === activeType) : cards;
    statusEl.style.display = "none";

    if (filtered.length === 0) {
      bodyEl.innerHTML = `<p class="empty-msg">No hay cards${activeType ? ` de tipo "${activeType}"` : ""}.</p>`;
      return;
    }

    const table = document.createElement("table");
    table.className = "card-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Seq</th><th>Lane</th><th>Tipo</th><th>Título ES</th>
          <th>Pub.</th><th>Actualizado</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((c) => `
          <tr data-id="${c.id}">
            <td class="td-mono">${c.sequence}</td>
            <td class="td-center">${c.lane}</td>
            <td><span class="type-badge type-${c.type}">${TYPE_LABELS[c.type]}</span></td>
            <td class="td-title">${h(c.titleEs)}</td>
            <td class="td-center">
              <button class="pub-toggle ${c.published ? "published" : "draft"}"
                      data-pub="${c.published}" data-id="${c.id}"
                      title="${c.published ? "Publicado — click para despublicar" : "Borrador — click para publicar"}">
                ${c.published ? "✓" : "○"}
              </button>
            </td>
            <td class="td-date">${fmtDate(c.updatedAt)}</td>
            <td class="td-actions">
              <button class="btn-edit btn-icon" data-id="${c.id}" title="Editar">✎</button>
              <button class="btn-delete btn-icon btn-danger" data-id="${c.id}" title="Eliminar">✕</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;
    bodyEl.appendChild(table);

    // Edit
    for (const btn of table.querySelectorAll<HTMLButtonElement>(".btn-edit")) {
      btn.addEventListener("click", () => {
        const card = cards.find((c) => c.id === btn.dataset.id);
        if (card) cbs.onEdit(card);
      });
    }

    // Delete
    for (const btn of table.querySelectorAll<HTMLButtonElement>(".btn-delete")) {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta card? Esta acción no se puede deshacer.")) return;
        btn.disabled = true;
        try {
          await deleteFloat(btn.dataset.id!);
          void refresh();
        } catch (err) {
          alert(`Error al eliminar: ${String(err)}`);
          btn.disabled = false;
        }
      });
    }

    // Publish toggle
    for (const btn of table.querySelectorAll<HTMLButtonElement>(".pub-toggle")) {
      btn.addEventListener("click", async () => {
        const pub = btn.dataset.pub === "true";
        btn.disabled = true;
        try {
          await publishFloat(btn.dataset.id!, !pub);
          void refresh();
        } catch (err) {
          alert(`Error: ${String(err)}`);
          btn.disabled = false;
        }
      });
    }
  };

  await refresh();
}

function h(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch { return iso; }
}
