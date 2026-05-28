---
name: web-research
description: research a topic or question using web search, then summarize with sources
allowed_tools:
  - web_search
  - "mcp__web-tools__*"
---

# Web research

When this skill is active, your job is to answer the user's question using web tools, not prior
knowledge alone.

1. Break the question into one or two focused search queries.
2. Call `web_search` (or a `mcp__web-tools__*` crawl/search tool if available) for each.
3. Read the result snippets; if a single page clearly holds the answer, crawl it for detail.
4. Synthesize a concise answer in your own words — 3–6 sentences or a short list.
5. End with a **Sources** line listing the page titles/URLs you relied on.

Prefer recent, reputable sources. If the searches return nothing useful, say so plainly rather
than guessing.
