import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, getJSON, putJSON } from "../api/client";
import { pushToast } from "../store/toast";
import { useScopedQuery } from "./useScopedQuery";

// Discovered skills (Phase 4.5 / 7d). `GET /api/skills` re-scans skills/<name>/SKILL.md each call.
// Used by the Agents editor (skill allowlist ticks) and the Skills panel (7d-c). The file CRUD
// (GET/PUT/DELETE /api/skills/{name}) edits the raw SKILL.md; the provider re-reads per call so a
// save is live with no restart.

export interface SkillInfo {
  name: string;
  description: string;
  allowed_tools: string[] | null;
}

/** Discovered skills. Scoped to the Conf tab (both consumers — ConfTab + SkillsEditor —
 *  live there). Re-entry to Conf force-refreshes via useScopedQuery's policy. */
export function useSkills() {
  return useScopedQuery<SkillInfo[]>("conf", {
    queryKey: ["skills"],
    queryFn: () => getJSON<SkillInfo[]>("/api/skills"),
    staleTime: 30_000,
  });
}

/** The raw SKILL.md text for one skill — fetched lazily when its editor row is opened. */
export function useSkillFile(name: string | null) {
  return useQuery({
    queryKey: ["skill-file", name],
    queryFn: () =>
      getJSON<{ name: string; content: string }>(`/api/skills/${encodeURIComponent(name!)}`),
    enabled: !!name,
    staleTime: 0,
  });
}

function useInvalidateSkills() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["skills"] });
    void qc.invalidateQueries({ queryKey: ["actions"] }); // a skill's allowed_tools can affect routing
  };
}

/** Create or overwrite skills/<name>/SKILL.md. Blank content asks the backend for a scaffold. */
export function useSaveSkill() {
  const qc = useQueryClient();
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      putJSON<{ name: string; content: string }>(`/api/skills/${encodeURIComponent(name)}`, {
        content,
      }),
    onSuccess: (res) => {
      qc.setQueryData(["skill-file", res.name], res);
      invalidate();
      pushToast("Skill saved", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Save failed", "err"),
  });
}

export function useDeleteSkill() {
  const invalidate = useInvalidateSkills();
  return useMutation({
    mutationFn: (name: string) => del(`/api/skills/${encodeURIComponent(name)}`),
    onSuccess: () => {
      invalidate();
      pushToast("Skill removed", "ok");
    },
    onError: (e: Error) => pushToast(e.message || "Delete failed", "err"),
  });
}
