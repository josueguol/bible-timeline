import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:5083",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
