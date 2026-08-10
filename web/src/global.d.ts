// Type declarations for external OAuth SDKs loaded via <script> tags.

interface Window {
  // ── Google Identity Services ──────────────────────────────────────────────
  google?: {
    accounts: {
      id: {
        initialize(config: {
          client_id: string;
          callback: (response: { credential: string }) => void;
          auto_select?: boolean;
          cancel_on_tap_outside?: boolean;
        }): void;
        prompt(momentListener?: (notification: {
          isNotDisplayed(): boolean;
          isSkippedMoment(): boolean;
        }) => void): void;
        renderButton(parent: HTMLElement, config: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: string;
          shape?: "rectangular" | "pill" | "circle" | "square";
          width?: number;
        }): void;
        cancel(): void;
      };
    };
  };

  // ── Facebook SDK ──────────────────────────────────────────────────────────
  FB?: {
    init(config: { appId: string; version: string; xfbml?: boolean; cookie?: boolean }): void;
    login(
      callback: (response: {
        status: string;
        authResponse?: { accessToken: string; userID: string } | null;
      }) => void,
      options?: { scope: string },
    ): void;
  };
  fbAsyncInit?: () => void;
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_FACEBOOK_APP_ID?: string;
}
