# Tessery UI refresh

Issue #108. Built on the `feat/ui-refresh` branch for review.

## Why

Tessery's own interface looks dated next to the apps its builder produces. The home page leads with templates and says nothing about what runs or what needs attention, the palette is one orange on flat grey, and loading shows a bare "Loading…" or briefly an empty table. The user wants it professional, friendly to developers and alive, with nothing Tessery does today going missing.

## Research

Developer platforms have converged on the same shape:

- **Navigation:** a persistent left sidebar with the workspace switcher at the top, kept dimmer than the content so the page leads.
- **Home:** your projects plus what just happened, with each project shown as a small picture of its services and one plain status line.
- **Colour:** chrome stays near-monochrome; colour comes from content such as status dots and service icons. Attention is earned: few icons, soft separators.
- **Status as one plain line** rather than badges.

What Tessery has that general deployment platforms don't: every project is a design, and every release travels a development → staging → production pipeline with approvals. The home page shows both.

## Direction (chosen by the user: sidebar with the content on a floating panel)

### Shell, for every page outside the project editor

```
 app background (darkest)
┌─────────────────────┐┌──────────────────────────────────────────────────┐
│ [■] Martian      v «││ Page title                     actions           │
│ [Search…        ⌘K] ││──────────────────────────────────────────────────│
│ Projects            ││                                                  │
│                     ││   content, scrolls inside the panel              │
│ Organization        ││                                                  │
│   General           ││                                                  │
│   Members  Teams …  ││                                                  │
│ Instance            ││                                                  │
│   Users  Email …    ││                                                  │
│ [A] Admin         ⋯ ││                                                  │
└─────────────────────┘└──────────────────────────────────────────────────┘
```

- The sidebar sits on the app background, dimmer than the content. The content is a floating panel: inset 8px, rounded, hairline border, its own scroll.
- Collapsing (the « button, or `[`) turns the sidebar into a 52px rail of icons with tooltips; the panel takes the width. The choice is remembered per browser. Narrow windows start collapsed.
- Every destination that exists today stays: projects; organization general, members, teams, servers, integrations, roles, access and audit log (filtered by permission); instance users, organizations, email, GitHub and settings (instance admins only); account; organization switching and creation; sign out.
- `⌘K` / `Ctrl+K` opens a quick switcher for projects and pages.

### Home

```
│ Projects  2                    [Search projects  /]  [▦|≡]  [New project] │
│ ┌───────────────────────┐ ┌───────────────────────┐  │ Waiting for you    │
│ │  web ── svc ── pg     │ │  web  svc  pg  idp    │  │ ◐ Seed library     │
│ │                       │ │                       │  │   to Production    │
│ │ Seed library      ⋯   │ │ todo              ⋯   │  │ Recent releases    │
│ │ A neighbourhood seed… │ │ Projects and tasks…   │  │ ✕ todo  Staging    │
│ │ ●─●─◐ Production is   │ │ ●─✕─○ Staging failed  │  │ ● Seed  Staging    │
│ │ waiting for approval  │ │                  12m  │  │ ● Seed  Development│
│ └───────────────────────┘ └───────────────────────┘  │                    │
│ Start from a template:  Blank  Task tracker  B2B SaaS  …                   │
```

- Cards show the design as its tech icons on a dotted ground, in the canvas's own category colours, then name, one line of description, and one status line: the pipeline as connected dots in environment colours plus a sentence about the most important state.
- A list view (remembered) shows the same as dense rows.
- The right rail lists releases waiting for approval first, then recent releases across projects; each opens that project on its Deploy tab at that release.
- Templates stay on the home page as a compact row and in the New project dialog.

### Loading

A `Skeleton` primitive replaces every "Loading…": the app boot shows the shell with placeholder blocks, cards and rows show their own shapes, tables show placeholder rows instead of "Nothing here yet", and the rail shows placeholder entries. Shimmer stops under reduced motion.

### Colour and type

- Neutrals: untinted greys. App `#09090a`, panel `#121213`, raised `#1b1b1c`, hover `#232425`, lines `#212224` and `#27282a`, text `#e2e3e5`, secondary `#949597`, faint `#6b6f76`.
- Brand indigo `#5f62e6` only for primary actions, focus and selection (white text on it is 4.8:1). Environments: development cyan, staging violet, production green. States: green, amber, red. Node categories keep their vivid hues; they are the colour of the product.
- Inter with its optical-size axis (display cut at heading sizes), JetBrains Mono for code; both bundled, nothing loaded from Google.
- Sentence case everywhere, no tracked capitals.

## Phases

1. Shell, home, settings, admin and account pages, skeletons. (This pass.)
2. The project editor inside the same shell, with the rail collapsed by default.

## Non-goals

No light theme yet (tokens allow it), no new product features beyond the home page's activity rail and the quick switcher.
