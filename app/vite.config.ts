import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port for dev; use 1420 (Tauri default).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2021",
    outDir: "dist",
  },
});
