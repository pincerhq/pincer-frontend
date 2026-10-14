import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Serves `/config.js` (`window.__ENV__`) in dev and preview.
 *
 * The app reads its configuration from that global, never from
 * `import.meta.env`, so nothing is inlined into the bundle. In the container
 * `docker/40-runtime-env.sh` writes the same file from the environment; here
 * it is built from `.env*` and the shell. Everything with these prefixes is
 * served to the browser, so neither may ever name a secret.
 */
function runtimeEnv(mode: string): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split("?")[0] !== "/config.js") return next();
    const env = loadEnv(mode, process.cwd(), ["VITE_", "SIGNUP_"]);
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-store");
    res.end(`window.__ENV__ = ${JSON.stringify(env, null, 2).replace(/</g, "\\u003c")};\n`);
  };
  return {
    name: "runtime-env",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 3000,
    strictPort: true,
  },
  plugins: [react(), runtimeEnv(mode)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
