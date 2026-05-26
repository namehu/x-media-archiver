import { defineConfig } from "wxt";

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
  }
});
