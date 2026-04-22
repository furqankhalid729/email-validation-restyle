import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    allowedHosts: ["4b38-182-184-200-77.ngrok-free.app"],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
