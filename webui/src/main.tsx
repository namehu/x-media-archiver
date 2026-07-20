import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { Suspense, lazy, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider, useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "./components/layout/app-layout";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { applyTheme, getStoredTheme, ThemeProvider } from "./lib/theme";
import { AuthGate } from "./lib/auth";
import { isTweetDetailPath } from "./lib/debug-redaction";
import {
  buildDebuggerSearch,
  initializeDebuggerMode,
  persistDebuggerMode,
  resolveDebuggerMode,
  syncDebuggerMode,
} from "./lib/debugger-mode";
import "./styles.css";

const DashboardPage = lazy(() =>
  import("./pages/dashboard").then((module) => ({
    default: module.DashboardPage,
  })),
);
const DuplicatesPage = lazy(() =>
  import("./pages/duplicates").then((module) => ({
    default: module.DuplicatesPage,
  })),
);
const FailuresPage = lazy(() =>
  import("./pages/failures").then((module) => ({
    default: module.FailuresPage,
  })),
);
const ArchiveQueuePage = lazy(() =>
  import("./pages/archive-queue").then((module) => ({
    default: module.ArchiveQueuePage,
  })),
);
const LibraryPage = lazy(() => import("./pages/library").then((module) => ({ default: module.LibraryPage })));
const FeedPage = lazy(() => import("./pages/feed").then((module) => ({ default: module.FeedPage })));
const OperationsPage = lazy(() =>
  import("./pages/operations").then((module) => ({
    default: module.OperationsPage,
  })),
);
const SourcesPage = lazy(() => import("./pages/sources").then((module) => ({ default: module.SourcesPage })));
const TweetDetailPage = lazy(() =>
  import("./pages/tweet-detail").then((module) => ({
    default: module.TweetDetailPage,
  })),
);

applyTheme(getStoredTheme());
initializeDebuggerMode();

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: route(<DashboardPage />) },
      { path: "feed", element: route(<FeedPage />) },
      { path: "library", element: route(<LibraryPage />) },
      { path: "tweets/:tweetId", element: route(<TweetDetailPage />) },
      { path: "failures", element: route(<FailuresPage />) },
      { path: "duplicates", element: route(<DuplicatesPage />) },
      { path: "operations", element: route(<OperationsPage />) },
      { path: "queue", element: route(<ArchiveQueuePage />) },
      { path: "sources", element: route(<SourcesPage />) },
    ],
  },
]);

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const state = resolveDebuggerMode(location.search);

    syncDebuggerMode(state.enabled);

    if (state.persist) {
      persistDebuggerMode(state.enabled);
    }

    if (state.enabled && isTweetDetailPath(location.pathname)) {
      navigate(
        {
          pathname: "/library",
          search: buildDebuggerSearch(location.search, true),
        },
        { replace: true },
      );
      return;
    }

    if (state.enabled && !state.hasUrlFlag) {
      navigate(
        {
          pathname: location.pathname,
          search: buildDebuggerSearch(location.search, true),
          hash: location.hash,
        },
        { replace: true },
      );
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  return <AppLayout />;
}

function route(element: React.ReactNode) {
  return <Suspense fallback={<Skeleton className="h-64" />}>{element}</Suspense>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthGate>
            <RouterProvider router={router} />
          </AuthGate>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
