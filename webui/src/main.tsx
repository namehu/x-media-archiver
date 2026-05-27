import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import "./styles.css";
import { DashboardPage } from "./pages/DashboardPage";
import { DuplicatesPage } from "./pages/DuplicatesPage";
import { FailuresPage } from "./pages/FailuresPage";
import { LibraryPage } from "./pages/LibraryPage";
import { OperationsPage } from "./pages/OperationsPage";
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
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
