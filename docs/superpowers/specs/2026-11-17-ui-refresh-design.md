# Tessery UI refresh

Issue #108. A first pass on a branch for review, not a final redesign.

## Why

Tessery's own interface looks dated next to the apps its page builder now produces. The home page leads with templates, so people scroll past seven cards to reach their own work, and it says nothing about whether anything is running or broken. The palette is a flat grey with one orange for every purpose. The user wants it livelier, more professional and friendlier to developers, and liked how alive the Seed library felt: several confident colours that each had a job, on tinted rather than grey neutrals.

## Subject and audience

A developer or small team that designs systems, generates code and deploys it through dev, staging and production, often self-hosted. They come back to check on their projects and to continue editing one. The name comes from *tessera*, a mosaic tile, and every project already is a mosaic of coloured parts: the canvas gives each kind of node its own colour.

## Direction

**One memorable thing: each project shows its own mosaic.** Project cards on the home page draw the project's real nodes as coloured tiles, using the same category colours as the canvas. Two projects never look alike, and you recognise yours at a glance. Everything around it stays quiet.

**Colour.** Keep the dark, editor-first look, but tint the neutrals toward ink blue instead of flat grey, and give colour jobs:
- Brand and primary action: a clearer, hotter orange `#FF7A2E` (the old `#E8833A` sat close to a clay tone that reads as generic).
- Environments get identity colours used everywhere they appear: Development cyan `#3CCFE8`, Staging violet `#A48BFF`, Production green `#3DDC97`.
- States: running green, waiting amber `#FFC247`, failed red `#FF5D6C`.
- Node categories keep their hues, tuned a little brighter so they hold up on the new background.

Neutrals: `#0E1018` page, `#141826` panels, `#1A1F30` raised, `#232A3F` hover, lines `#262D44` and `#323A55`, text `#E9ECF6`, secondary `#A2A9C4`, faint `#6A7291`.

**Type.** Headings (page titles, project names, section titles) in Bricolage Grotesque, which gives the product a voice. Interface text stays in Inter for legibility at small sizes, code in JetBrains Mono. Fonts are bundled with the app, not loaded from Google, because Tessery is self-hosted. Section labels become sentence case instead of tracked capitals.

## Home page

```
[tiles] Tessery   Martian v   Projects  Organization  Admin                 Admin v
--------------------------------------------------------------------------------
Projects in Martian                                      [Filter]  [New project]

Needs attention                       (only when something does)
  ! Seed library   Production waiting for approval              Review
  ! todo           Staging release failed: API check failed      Open

+-------------------------------+  +-------------------------------+
| [mosaic of the project's nodes]|  | [mosaic]                      |
| Seed library                  |  | todo                          |
| A neighbourhood seed library  |  | Projects and tasks...         |
| (dev #3) (staging #3) (prod #3)|  | (dev #26)                     |
| Edited 2 hours ago            |  | Edited yesterday              |
+-------------------------------+  +-------------------------------+

Start something new
  [Blank] [Task tracker] [B2B SaaS] [Realtime chat] [IoT] [AI assistant] [Store]
```

- Your projects come first, as cards in a responsive grid. Each card shows the mosaic, name, description, one pill per environment in its colour with the running checkpoint, and when it was edited.
- A pill also shows the latest release's state when it differs from running: waiting for approval (amber) or failed (red).
- "Needs attention" lists pending approvals and failed latest releases across the organization, and is hidden when there are none.
- Templates move below as a compact row; "New project" in the header opens the same choice.
- An empty organization shows the templates as the main call to action.

The server adds two fields to the project list for this: the node types of each design (for the mosaic) and the latest release per environment (for states and attention). Both come from the existing list query, with no extra request per project.

## Project page

The editor layout stays (left library and outliner, canvas, inspector, bottom panel); it works and people know it. This pass changes how it looks, not where things are:
- The new tokens and type throughout.
- The workspace tabs read as tabs: clearer active state in the brand colour, quieter inactive ones.
- The environment switcher shows the environment's colour.
- Panel section titles in sentence case.

A deeper rework of the workspace (header layout, small screens) is left for a follow-up once this direction is agreed.

## Non-goals

- No light theme yet; tokens are organised so one can be added.
- No new navigation model or command palette changes.
- No change to what any screen does, beyond the home page's new information.

## Approaches considered

1. **Token refresh only:** fast and low risk, but the home page would still not show what's running or needs attention.
2. **Tokens plus a rebuilt home page plus a polish pass on the workspace (chosen):** the home page is where "dated" and "doesn't help me" were felt most, and the tokens lift every other screen at once.
3. **Full redesign of every screen:** too big to review as one change, and better done after the direction is agreed.
