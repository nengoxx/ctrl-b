// TanStack Query hooks. Polling lives here, not scattered setInterval calls.
// To go live: swap `api` for an HTTP client implementing CtrlbApi.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mockApi } from "./mock";
import type { ActionType } from "../types";

const api = mockApi;

export function useHosts() {
  return useQuery({
    queryKey: ["hosts"],
    queryFn: () => api.listHosts(),
    refetchInterval: 15_000,
  });
}

export function useServices() {
  return useQuery({ queryKey: ["services"], queryFn: () => api.listServices(), refetchInterval: 20_000 });
}

export function useEvents() {
  return useQuery({ queryKey: ["events"], queryFn: () => api.listEvents(), refetchInterval: 20_000 });
}

export function useHostAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hostId, action }: { hostId: string; action: ActionType }) =>
      api.runHostAction(hostId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hosts"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useServiceAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, action }: { serviceId: string; action: ActionType }) =>
      api.runServiceAction(serviceId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function sendChat(content: string) {
  return api.sendChat(content);
}
