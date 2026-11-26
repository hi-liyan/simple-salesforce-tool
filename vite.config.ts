import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "zustand", "@tanstack/react-query"],
          "vendor-monaco": ["monaco-editor", "@monaco-editor/react", "monaco-sql-languages"],
          "vendor-codemirror": [
            "@codemirror/autocomplete",
            "@codemirror/commands",
            "@codemirror/lang-sql",
            "@codemirror/language",
            "@codemirror/lint",
            "@codemirror/state",
            "@codemirror/view"
          ],
          "vendor-datagrid": ["@glideapps/glide-data-grid"],
          "vendor-xterm": ["@xterm/xterm", "@xterm/addon-fit"]
        }
      }
    }
  }
});
