import { useQuery } from "@tanstack/react-query";

import { getJSON } from "../api/client";

// Discovered skills (Phase 4.5 / 7d). `GET /api/skills` re-scans skills/<name>/SKILL.md each call.
// Used by the Agents editor (skill allowlist ticks) and the Skills panel (7d-c).

export interface SkillInfo {
  name: string;
  description: string;
  allowed_tools: string[] | null;
}

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => getJSON<SkillInfo[]>("/api/skills"),
    staleTime: 30_000,
  });
}
