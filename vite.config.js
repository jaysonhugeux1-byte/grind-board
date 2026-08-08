import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Chemins relatifs : nécessaire pour que l'appli de bureau Electron charge
  // correctement les assets depuis dist/index.html via file:// (pas de serveur).
  base: "./",
  plugins: [react()],
});
