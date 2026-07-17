import { createContext, useContext, type ReactNode } from "react";

const AppScrollContainerContext = createContext<HTMLElement | null>(null);

export function AppScrollContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return <AppScrollContainerContext.Provider value={container}>{children}</AppScrollContainerContext.Provider>;
}

export function useAppScrollContainer() {
  return useContext(AppScrollContainerContext);
}
