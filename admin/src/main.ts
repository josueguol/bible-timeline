import "./style.css";
import { getAccessToken, login } from "./api.ts";
import type { FloatCard } from "./api.ts";
import { renderCardList } from "./card-list.ts";
import { renderCardEditor } from "./card-editor.ts";

const app = document.getElementById("app")!;

type View = "login" | "list" | "editor";
let currentView: View = "login";
let editingCard: FloatCard | null = null;

function navigate(view: View, card: FloatCard | null = null): void {
  currentView = view;
  editingCard = card;
  render();
}

function render(): void {
  if (currentView === "login" || !getAccessToken()) {
    renderLogin();
  } else if (currentView === "list") {
    void renderCardList(app, {
      onNew:  () => navigate("editor", null),
      onEdit: (c) => navigate("editor", c),
    });
  } else if (currentView === "editor") {
    renderCardEditor(app, editingCard, {
      onSaved:  () => navigate("list"),
      onCancel: () => navigate("list"),
    });
  }
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1 class="login-title">Bible Timeline</h1>
        <p class="login-sub">Administración de contenido</p>
        <form id="login-form" novalidate>
          <label class="field-label">Email
            <input id="login-email" type="email" class="field-input" autocomplete="username" required>
          </label>
          <label class="field-label" style="margin-top:12px">Contraseña
            <input id="login-pwd" type="password" class="field-input" autocomplete="current-password" required>
          </label>
          <p id="login-err" class="editor-error" style="display:none;margin-top:8px"></p>
          <button type="submit" id="login-btn" class="btn btn-primary" style="width:100%;margin-top:20px">
            Entrar
          </button>
        </form>
      </div>
    </div>
  `;

  const form     = app.querySelector<HTMLFormElement>("#login-form")!;
  const errEl    = app.querySelector<HTMLElement>("#login-err")!;
  const loginBtn = app.querySelector<HTMLButtonElement>("#login-btn")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";
    const email = app.querySelector<HTMLInputElement>("#login-email")!.value.trim();
    const pwd   = app.querySelector<HTMLInputElement>("#login-pwd")!.value;

    loginBtn.disabled = true;
    loginBtn.textContent = "Verificando…";

    try {
      await login(email, pwd);
      navigate("list");
    } catch {
      errEl.textContent = "Credenciales incorrectas.";
      errEl.style.display = "block";
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    }
  });
}

// Boot: if token exists skip login
if (getAccessToken()) {
  navigate("list");
} else {
  navigate("login");
}
