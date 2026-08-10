export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
}

type AuthListener = (state: Readonly<AuthState>) => void;

class AuthStore extends EventTarget {
  private state: AuthState = { user: null, accessToken: null };

  getState(): Readonly<AuthState> {
    return this.state;
  }

  setTokens(accessToken: string, user: { id: string; email: string; displayName: string }): void {
    this.state = { user, accessToken };
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  clear(): void {
    this.state = { user: null, accessToken: null };
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  subscribe(listener: AuthListener): () => void {
    const handler = (e: Event) =>
      listener((e as CustomEvent<AuthState>).detail);
    this.addEventListener("change", handler);
    return () => this.removeEventListener("change", handler);
  }

  isAuthenticated(): boolean {
    return this.state.user !== null;
  }
}

export const authStore = new AuthStore();
