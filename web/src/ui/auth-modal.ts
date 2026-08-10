import { authStore } from "@store/auth-store.ts";
import {
  apiLogin, apiLogout, apiRegister,
  apiLoginGoogle, apiLoginFacebook,
  NotesApiError, type AuthTokenResponse,
} from "@api/notes.ts";

type Tab = "login" | "register";

// Warm amber used for CTAs — matches --color-accent (oklch 0.78 0.14 85) family
const WARM = "oklch(0.72 0.20 50)";       // deep amber-orange
const WARM_DARK = "oklch(0.14 0.015 260)"; // near-black text on warm bg

export class AuthModal {
  readonly el: HTMLElement;
  private tab: Tab = "login";
  private emailEl!: HTMLInputElement;
  private passwordEl!: HTMLInputElement;
  private confirmEl!: HTMLInputElement;
  private errorEl!: HTMLElement;
  private submitBtn!: HTMLButtonElement;
  private onClose: (() => void) | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.role = "dialog";
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Iniciar sesión");
    this.el.dataset.noDrag = "1";
    this.el.style.cssText =
      "position:fixed;inset:0;z-index:200;display:flex;align-items:center;" +
      "justify-content:center;background:rgba(0,0,0,.60);backdrop-filter:blur(6px);";
    this.render();
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.switchTab("login");
    document.body.appendChild(this.el);
    this.emailEl.focus();
  }

  close(): void {
    this.el.remove();
    if (this.onClose) this.onClose();
  }

  private render(): void {
    this.el.innerHTML = "";

    const panel = document.createElement("div");
    panel.style.cssText =
      "background:var(--color-bg-deep);border:1px solid var(--color-border);" +
      "border-radius:14px;padding:28px 28px 24px;width:min(400px,92vw);" +
      "box-shadow:0 12px 40px rgba(0,0,0,.5);";

    // Header
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;";
    const title = document.createElement("h2");
    title.style.cssText = "margin:0;font-size:1.1rem;color:var(--color-text);font-weight:600;";
    title.textContent = this.tab === "login" ? "Iniciar sesión" : "Crear cuenta";
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Cerrar");
    closeBtn.style.cssText =
      "background:none;border:none;cursor:pointer;font-size:1.5rem;" +
      "color:var(--color-text-mute);padding:2px;line-height:1;";
    closeBtn.textContent = "×";
    closeBtn.onclick = () => this.close();
    header.append(title, closeBtn);

    // Tabs
    const tabs = document.createElement("div");
    tabs.style.cssText =
      "display:flex;gap:0;border-bottom:1px solid var(--color-border);margin-bottom:22px;";
    tabs.append(this.makeTab("Iniciar sesión", "login"), this.makeTab("Crear cuenta", "register"));

    // Form
    const form = document.createElement("form");
    form.noValidate = true;

    this.emailEl = this.makeInput("email", "Correo electrónico", "email" as AutoFill);
    this.passwordEl = this.makeInput("password", "Contraseña",
      (this.tab === "login" ? "current-password" : "new-password") as AutoFill);

    this.confirmEl = this.makeInput("password", "Confirmar contraseña", "new-password" as AutoFill);
    this.confirmEl.style.display = this.tab === "register" ? "" : "none";

    this.errorEl = document.createElement("p");
    this.errorEl.role = "alert";
    this.errorEl.style.cssText =
      "color:oklch(0.65 0.22 25);font-size:.82rem;margin:0 0 10px;min-height:1.1em;";

    this.submitBtn = document.createElement("button");
    this.submitBtn.type = "submit";
    this.submitBtn.style.cssText =
      `width:100%;padding:11px;border:none;border-radius:9px;` +
      `background:${WARM};color:${WARM_DARK};` +
      "font-size:1rem;cursor:pointer;font-weight:700;letter-spacing:.01em;";
    this.submitBtn.textContent = this.tab === "login" ? "Entrar" : "Crear cuenta";

    const switchLink = document.createElement("p");
    switchLink.style.cssText =
      "text-align:center;font-size:.82rem;color:var(--color-text-mute);margin:12px 0 0;";
    if (this.tab === "login") {
      switchLink.innerHTML = `¿No tienes cuenta? <a href="#" style="color:${WARM};text-decoration:none;font-weight:600;">Regístrate</a>`;
      switchLink.querySelector("a")!.onclick = (e) => { e.preventDefault(); this.switchTab("register"); };
    } else {
      switchLink.innerHTML = `¿Ya tienes cuenta? <a href="#" style="color:${WARM};text-decoration:none;font-weight:600;">Inicia sesión</a>`;
      switchLink.querySelector("a")!.onclick = (e) => { e.preventDefault(); this.switchTab("login"); };
    }

    form.append(this.emailEl, this.passwordEl, this.confirmEl, this.errorEl, this.submitBtn, switchLink);
    form.onsubmit = (e) => { e.preventDefault(); void this.submitPassword(); };

    // Social divider
    const divider = document.createElement("div");
    divider.style.cssText =
      "display:flex;align-items:center;gap:10px;margin:20px 0 16px;";
    const line = () => {
      const l = document.createElement("div");
      l.style.cssText = "flex:1;height:1px;background:var(--color-border);";
      return l;
    };
    const divText = document.createElement("span");
    divText.style.cssText = "font-size:.75rem;color:var(--color-text-mute);white-space:nowrap;";
    divText.textContent = "o continúa con";
    divider.append(line(), divText, line());

    // Social buttons
    const socialRow = document.createElement("div");
    socialRow.style.cssText = "display:flex;gap:10px;";

    const googleBtn = this.makeSocialBtn("Google", "G", "#4285F4");
    const fbBtn     = this.makeSocialBtn("Facebook", "f", "#1877F2");
    const xBtn      = this.makeSocialBtn("X / Twitter", "𝕏", "#000000", "2px solid #fff");

    googleBtn.onclick = () => void this.loginGoogle();
    fbBtn.onclick     = () => void this.loginFacebook();
    xBtn.onclick      = () => this.loginTwitter();

    socialRow.append(googleBtn, fbBtn, xBtn);

    panel.append(header, tabs, form, divider, socialRow);
    this.el.appendChild(panel);
    this.el.onclick = (e) => { if (e.target === this.el) this.close(); };
    this.el.onkeydown = (e) => { if (e.key === "Escape") this.close(); };
  }

  private makeTab(label: string, id: Tab): HTMLButtonElement {
    const active = this.tab === id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText =
      "flex:1;padding:8px;border:none;background:none;cursor:pointer;font-size:.88rem;" +
      `color:${active ? WARM : "var(--color-text-mute)"};` +
      `border-bottom:2px solid ${active ? WARM : "transparent"};font-weight:${active ? "600" : "400"};`;
    btn.onclick = () => this.switchTab(id);
    return btn;
  }

  private makeInput(type: string, placeholder: string, autocomplete: AutoFill): HTMLInputElement {
    const el = document.createElement("input");
    el.type = type;
    el.placeholder = placeholder;
    el.autocomplete = autocomplete;
    el.required = true;
    el.style.cssText =
      "width:100%;box-sizing:border-box;padding:10px 13px;margin-bottom:11px;" +
      "border:1px solid var(--color-border);border-radius:8px;" +
      "background:var(--color-surface);color:var(--color-text);font-size:.95rem;" +
      "outline:none;transition:border-color .15s;";
    el.addEventListener("focus", () => { el.style.borderColor = WARM; });
    el.addEventListener("blur",  () => { el.style.borderColor = "var(--color-border)"; });
    return el;
  }

  private makeSocialBtn(label: string, icon: string, bg: string, border = "none"): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", `Iniciar sesión con ${label}`);
    btn.style.cssText =
      `flex:1;display:flex;align-items:center;justify-content:center;gap:7px;` +
      `padding:9px 6px;border:${border};border-radius:9px;cursor:pointer;` +
      `background:${bg};color:#fff;font-size:.82rem;font-weight:600;` +
      "transition:opacity .15s;";
    btn.onmouseenter = () => { btn.style.opacity = "0.85"; };
    btn.onmouseleave = () => { btn.style.opacity = "1"; };

    const iconEl = document.createElement("span");
    iconEl.style.cssText = "font-size:1rem;line-height:1;";
    iconEl.textContent = icon;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    btn.append(iconEl, labelEl);
    return btn;
  }

  private switchTab(tab: Tab): void {
    this.tab = tab;
    this.render();
  }

  // ── Password submit ───────────────────────────────────────────────────────

  private async submitPassword(): Promise<void> {
    this.errorEl.textContent = "";
    this.submitBtn.disabled = true;
    const email    = this.emailEl.value.trim();
    const password = this.passwordEl.value;

    try {
      let resp: AuthTokenResponse;
      if (this.tab === "login") {
        resp = await apiLogin(email, password);
      } else {
        const confirm = this.confirmEl.value;
        if (password !== confirm) { this.errorEl.textContent = "Las contraseñas no coinciden"; return; }
        if (password.length < 8)  { this.errorEl.textContent = "Mínimo 8 caracteres"; return; }
        resp = await apiRegister(email, password);
      }
      storeAuthResponse(resp);
      this.close();
    } catch (err) {
      this.errorEl.textContent = friendlyError(err);
    } finally {
      this.submitBtn.disabled = false;
    }
  }

  // ── Google popup ──────────────────────────────────────────────────────────

  private async loginGoogle(): Promise<void> {
    const clientId = (import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined) ?? "";
    if (!clientId) {
      this.errorEl.textContent = "Google login no configurado. Agrega VITE_GOOGLE_CLIENT_ID en .env.local";
      return;
    }
    if (!window.google) {
      this.errorEl.textContent = "SDK de Google no cargado. Verifica conexión.";
      return;
    }
    this.errorEl.textContent = "";
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        try {
          const resp = await apiLoginGoogle(response.credential);
          storeAuthResponse(resp);
          this.close();
        } catch (err) {
          this.errorEl.textContent = friendlyError(err);
        }
      },
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.prompt((n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        this.errorEl.textContent = "No se pudo abrir el popup de Google. Habilita ventanas emergentes.";
      }
    });
  }

  // ── Facebook popup ────────────────────────────────────────────────────────

  private async loginFacebook(): Promise<void> {
    const appId = (import.meta.env["VITE_FACEBOOK_APP_ID"] as string | undefined) ?? "";
    if (!appId) {
      this.errorEl.textContent = "Facebook login no configurado. Agrega VITE_FACEBOOK_APP_ID en .env.local";
      return;
    }
    this.errorEl.textContent = "";

    if (!window.FB) {
      this.errorEl.textContent = "SDK de Facebook no cargado. Verifica conexión.";
      return;
    }
    window.FB.init({ appId, version: "v19.0" });
    window.FB.login((response) => {
      const token = response.authResponse?.accessToken;
      if (!token) {
        this.errorEl.textContent = "Login con Facebook cancelado.";
        return;
      }
      void apiLoginFacebook(token)
        .then((resp) => { storeAuthResponse(resp); this.close(); })
        .catch((err) => { this.errorEl.textContent = friendlyError(err); });
    }, { scope: "email,public_profile" });
  }

  // ── Twitter redirect ──────────────────────────────────────────────────────

  private loginTwitter(): void {
    window.location.href = "/notes-api/auth/twitter";
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────

export function logout(): void {
  const token = localStorage.getItem("notes_refresh_token");
  if (token) void apiLogout(token).catch(() => { /* noop */ });
  localStorage.removeItem("notes_refresh_token");
  authStore.clear();
}

// ── Twitter callback handler (called from main.ts on app load) ────────────────

export function handleTwitterCallback(): void {
  const params = new URLSearchParams(window.location.search);
  const hashParams = window.location.hash.startsWith("#")
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams();
  const tokenParams = hashParams.has("notes_at") ? hashParams : params;
  const at = tokenParams.get("notes_at");
  const rt = tokenParams.get("notes_rt");
  const dn = tokenParams.get("notes_dn");
  const id = tokenParams.get("notes_id");
  const em = tokenParams.get("notes_em");

  if (at && rt && dn && id && em) {
    localStorage.setItem("notes_refresh_token", rt);
    authStore.setTokens(at, { id, email: em, displayName: dn });
    // Clean URL without reload
    const clean = window.location.pathname;
    history.replaceState({}, "", clean);
  }

  const authError = params.get("auth_error");
  if (authError) {
    console.warn("OAuth error:", authError);
    history.replaceState({}, "", window.location.pathname);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storeAuthResponse(resp: AuthTokenResponse): void {
  localStorage.setItem("notes_refresh_token", resp.refreshToken);
  authStore.setTokens(resp.accessToken, resp.user);
}

function friendlyError(err: unknown): string {
  if (err instanceof NotesApiError) {
    if (err.status === 401) return "Correo o contraseña incorrectos";
    if (err.status === 409) return "Ese correo ya está registrado";
    if (err.status === 429) return "Demasiados intentos. Espera unos minutos.";
    if (err.message.includes("password")) return "La contraseña debe tener al menos 8 caracteres";
    if (err.message.includes("email"))    return "Formato de correo inválido";
  }
  return "Error inesperado. Intenta de nuevo.";
}
