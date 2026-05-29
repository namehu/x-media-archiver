import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        style: {
          background: "hsl(var(--bg-elevated))",
          border: "1px solid hsl(var(--border-subtle))",
          color: "hsl(var(--fg-primary))",
          boxShadow: "var(--shadow-3)",
        },
      }}
    />
  );
}
