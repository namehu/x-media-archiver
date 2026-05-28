import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ToastProvider } from "./components/ui/Toast";
import { I18nProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import "./styles.css";
import { DashboardPage } from "./pages/DashboardPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { FailuresPage } from "./pages/FailuresPage";
import { ArchiveQueuePage } from "./pages/ArchiveQueuePage";
import { LibraryPage } from "./pages/LibraryPage";
import { OperationsPage } from "./pages/OperationsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { TweetDetailPage } from "./pages/TweetDetailPage";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "tweets/:tweetId", element: <TweetDetailPage /> },
      { path: "failures", element: <FailuresPage /> },
      { path: "duplicates", element: <DuplicatesPage /> },
      { path: "operations", element: <OperationsPage /> },
      { path: "queue", element: <ArchiveQueuePage /> },
      { path: "sources", element: <SourcesPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider locale="zh">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
