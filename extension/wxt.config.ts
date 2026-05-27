import { defineConfig } from "wxt";
import path from "node:path";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "__MSG_extensionName__",
    short_name: "X Archiver",
    description: "__MSG_extensionDescription__",
    version: "0.1.0",
    default_locale: "en",
    action: {
      default_title: "__MSG_extensionActionTitle__"
    },
    permissions: ["activeTab", "scripting"],
    host_permissions: ["https://x.com/*", "https://twitter.com/*"]
  },
  hooks: {
    "vite:build:extendConfig": (_entrypoints, viteConfig) => {
      const input = viteConfig.build?.rollupOptions?.input;
      if (!input || Array.isArray(input) || typeof input === "string") return;

      for (const [name, value] of Object.entries(input)) {
        if (typeof value !== "string" || !path.isAbsolute(value)) continue;
        input[name] = path.relative(process.cwd(), value).replaceAll("\\", "/");
      }
    }
  }
});
