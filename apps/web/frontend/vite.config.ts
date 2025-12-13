import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: true,
        rewrite: (pathStr) => pathStr.replace(/^\/api/, "/api"),
      },
    },
    allowedHosts: ["app.dreamify.dev"],   // 👈 add your custom domain here
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor';
            }
            if (id.includes('recharts')) {
              return 'charts';
            }
            if (id.includes('html2canvas') || id.includes('jspdf')) {
              return 'pdf';
            }
            if (id.includes('lucide-react') || id.includes('@radix-ui')) {
              return 'ui';
            }
            return 'vendor';
          }
        }
      }
    },
    chunkSizeWarningLimit: 1500
  }
}));
