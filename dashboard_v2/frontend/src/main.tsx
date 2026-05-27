import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The canonical stylesheet — lifted verbatim from vapor.html (D7). Everything styles against it.
import "./theme/vapor.css";
// Net-new v2 component styling (toasts, confirm dialog) built from vapor tokens — see file header.
import "./theme/extras.css";
import App from "./App";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
