// An agent's SECOND LINE — what it IS, in one vocabulary wherever it is named under its title: the gallery
// card's plate and the open editor's header (`AgentsTab`'s `AgentCard`, `AgentsEditor`'s `AgentRow`). A
// leaf module because the two callers already import each other one way (the tab imports the editor), so
// defining it in either would close the cycle.

/** A description is the agent's own sentence and wins; without one, the line says which agent it is. */
export function agentSubtitle(name: string, description: string, isDefault: boolean): string {
  if (description.trim()) return description;
  // "workspace root", not "default agent": whether the root IS the default is the pill's to say now.
  return isDefault ? "workspace root" : `/agent ${name}`;
}
