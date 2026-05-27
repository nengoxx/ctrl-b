import { useQuery } from "@tanstack/react-query";

// Phase 0 placeholder — confirms the theme loads and the backend is reachable through the
// Vite /api proxy. Phase 1 replaces this with the ported Vapor Fleet tab.
interface Health {
  status: string;
  version: string;
  schema_version: number;
  server: { port: number; debug: boolean };
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

export default function App() {
  const { data, error, isLoading } = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          textAlign: "center",
          color: "var(--ink)",
          fontFamily: '"Major Mono Display", monospace',
        }}
      >
        <div style={{ fontSize: 32, letterSpacing: 2, color: "var(--magenta)" }}>ctrl-b</div>
        <div
          style={{
            marginTop: 12,
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: 13,
            color: "var(--ink-soft)",
          }}
        >
          {isLoading && "connecting to backend…"}
          {error && `backend unreachable: ${(error as Error).message}`}
          {data && (
            <>
              backend ok · v{data.version} · schema {data.schema_version} · :{data.server.port}
            </>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-faint)" }}>
          dashboard_v2 — Phase 0 scaffold
        </div>
      </div>
    </div>
  );
}
