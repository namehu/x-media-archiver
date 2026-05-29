import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { Skeleton } from "./components/ui/skeleton";
import { Toaster } from "./components/ui/toaster";
import { I18nProvider } from "./lib/i18n";
import { applyTheme, getStoredTheme, ThemeProvider } from "./lib/theme";
import "./styles.css";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const DuplicatesPage = lazy(() => import("./pages/DuplicatesPage").then((module) => ({ default: module.DuplicatesPage })));
const FailuresPage = lazy(() => import("./pages/FailuresPage").then((module) => ({ default: module.FailuresPage })));
const ArchiveQueuePage = lazy(() => import("./pages/ArchiveQueuePage").then((module) => ({ default: module.ArchiveQueuePage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((module) => ({ default: module.LibraryPage })));
const OperationsPage = lazy(() => import("./pages/OperationsPage").then((module) => ({ default: module.OperationsPage })));
const SourcesPage = lazy(() => import("./pages/SourcesPage").then((module) => ({ default: module.SourcesPage })));
const TweetDetailPage = lazy(() => import("./pages/TweetDetailPage").then((module) => ({ default: module.TweetDetailPage })));
const UiDemoPage = lazy(() => import("./pages/UiDemoPage").then((module) => ({ default: module.UiDemoPage })));

applyTheme(getStoredTheme());

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: route(<DashboardPage />) },
      { path: "library", element: route(<LibraryPage />) },
      { path: "tweets/:tweetId", element: route(<TweetDetailPage />) },
      { path: "failures", element: route(<FailuresPage />) },
      { path: "duplicates", element: route(<DuplicatesPage />) },
      { path: "operations", element: route(<OperationsPage />) },
      { path: "queue", element: route(<ArchiveQueuePage />) },
      { path: "sources", element: route(<SourcesPage />) },
      { path: "demo", element: route(<UiDemoPage />) },
    ],
  },
]);

function route(element: React.ReactNode) {
  return <Suspense fallback={<Skeleton className="h-64" />}>{element}</Suspense>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider locale="zh">
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
