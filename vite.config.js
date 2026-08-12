import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { fileURLToPath, URL } from "url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"));

export default defineConfig({
  // Chemins relatifs : nécessaire pour que l'appli de bureau Electron charge
  // correctement les assets depuis dist/index.html via file:// (pas de serveur).
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
