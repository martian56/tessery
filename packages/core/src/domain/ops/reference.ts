export const OPS_REFERENCE = `Design operations. Apply them in order with edit_design; each returns a result.
A string argument that is exactly "$N" is replaced by the result of operation N in the same batch
(addNode returns the new node id, addOperation the operation id, addTable the table id, and so on).

Nodes and connections
  addNode { techId, x, y, name?, config?, id? }  -> node id. techId from design_reference catalog, e.g. service, worker, postgres, redis, web-app, api-gateway.
      A service's config takes language (TypeScript, Go, Python, Rust, Java, ...), framework (Fastify, Hono, Express, chi, gin, FastAPI, ...), apiStyle (rest, graphql, grpc, websocket) and port.
  updateNode { id, patch: { name?, replicas?, notes? } }
  setConfig { id, key, value }
  removeNodes { ids }
  connect { source, target, sourcePort?, targetPort? }  -> edge id. Direction is caller to callee: web-app -> service -> postgres.
  Anywhere a node id is expected you may pass the node name instead, also in "node:operation" bindings.
  removeEdges { ids }
  renameProject { name?, description? }

APIs (for service nodes)
  updateApi { nodeId, patch: { style?, language?, framework?, basePath? } }
  addOperation { nodeId, kind, name, summary? }  -> operation id. REST kind is "METHOD /path", e.g. "GET /notes/{id}".
  addCrudOperations { nodeId, table, basePath? }  -> operation ids. List, get, create, update and delete endpoints for a table, implemented in SQL.
  updateOperation { nodeId, opId, patch: { kind?, name?, summary?, auth?, input?, output? } }
  setSteps { nodeId, opId, steps: string[] }
  removeOperation { nodeId, opId }

Database schemas (for postgres and other SQL nodes)
  addTable { nodeId, name }  -> table id. New tables start with an id uuid primary key and created_at.
  addColumn { nodeId, tableId, column: { name, type, nullable?, unique?, default?, ref?: { table, column, onDelete } } }  -> column id.
      type: uuid, text, varchar, int, bigint, serial, numeric, float, boolean, timestamptz, date, jsonb, bytea, enum, text[], vector
  updateColumn { nodeId, tableId, columnId, patch }
  removeColumn { nodeId, tableId, columnId }
  addIndex { nodeId, tableId, columns, unique? }
  removeTable { nodeId, tableId }

Web app pages (for web-app nodes)
  A page is a tree of elements under page.root, a frame. Read it with get_design before editing.
  addPage { appNodeId, name, route }  -> page id
  addElement { pageId, parentId?, index?, element }  -> element id. parentId defaults to the page root and must be a frame.
      element: { type, name?, props?, style?, tablet?, mobile?, hover?, children? } where children are elements (frames only).
      type and its props (every element also takes label, an accessible name, and tooltip):
        frame   { tag?, href?, source?, limit?, empty?, popover? }  lays out children with style.display flex or grid
                tag: div|section|header|footer|nav|main|article|aside|ul|ol|li|figure|label|search, form (a GET form; href is
                its action, e.g. a search bar posting to /search), details and summary (a disclosure: an accordion, a file
                tree folder; put a summary frame first), and href makes the frame a link (a card, a list row).
                source "<serviceNodeId>:<operationName>" repeats the frame's children once per record the operation returns,
                up to limit (default 50), showing empty when there are none. Inside, any text, href, image src, icon name or
                label can use {field}, {author.name}, {price|money}, {count|number}, {created_at|date}, {name|initials}.
                A server-rendered page passes its URL query to the read operations it loads. CRUD list operations read
                q (search of text columns), any column name as an exact filter (?crop=Bean), sort (name or -created_at)
                and page with limit. {?q} anywhere shows the current query value, e.g. an input value "{?q}" keeps a
                search box filled; a link whose href starts with ? (?crop=Bean, or ? for no filter) gets the current
                style when it matches the query shown, which makes filter chips and sort links.
                popover true hides the frame until a button with opens = its id is pressed (menus, dialogs, sheets).
                Place it with style.positionArea "bottom span-right" to open under the button, or position fixed for a dialog.
        text    { text, tag?, href? }  tag: h1|h2|h3|h4|p|span|small|strong|em|blockquote|label|li|code|pre|kbd|time|mark|del
        button  { text, href?, icon?, opens?, submit?, disabled? }  icon is a Lucide name shown before the text; opens toggles a
                popover frame; submit makes it the submit button of the form around it.
        icon    { name }  a Lucide icon by name (lucide.dev/icons): "search", "git-branch", "shopping-cart", "star", "inbox".
                Size it with style width/height, color with style.color, stroke with style.strokeWidth.
        input   { kind?, name?, placeholder?, value?, checked?, required?, disabled?, min?, max?, step?, rows? }
                kind: text|search|email|tel|url|number|password|date|checkbox|radio|range|textarea
        select  { options: "All, Books, Electronics", name?, value? }
        image   { src, alt }  src is an https URL or an uploaded asset "asset:<id>/<name>"
        video   { src, poster?, autoplay?, loop?, muted?, controls? }
        shape   { }  a rectangle or, with style.borderRadius "50%", an ellipse
        path    { d, viewBox }  an SVG path in viewBox units; style.stroke, style.strokeWidth and style.fill draw it
        embed   { src, title }  an https iframe such as a video or a map
        block   { block, ...props }  one of the blocks below, with props.source / props.action for data
      style is CSS in camelCase; numbers are pixels for lengths (fontSize: 64, gap: 24). Use theme tokens for color and type:
        var(--c-primary) var(--c-onPrimary) var(--c-text) var(--c-muted) var(--c-bg) var(--c-surface) var(--c-border) and any
        color you add with setTheme, var(--font-heading) var(--font-body) var(--font-mono) var(--radius).
        tablet (900px and below) and mobile (600px and below) override style; e.g. { style: { gridTemplateColumns:
        "repeat(3, 1fr)" }, mobile: { gridTemplateColumns: "1fr" } }. States override it too: hover, focus (keyboard focus;
        on a frame, focus anywhere inside it), active (pressed) and current (a link to the page being shown, an open
        details, a checked input), e.g. sidebar links with current: { background: "var(--c-surface)" }.
        position "absolute" with left/top places an element freely inside its parent frame; position "sticky" with top: 0
        pins headers and sidebars.
        animation can use the built-in keyframes tsp-fade, tsp-rise, tsp-scale, tsp-marquee, tsp-spin, tsp-pulse and
        tsp-shimmer, e.g. "tsp-rise .5s cubic-bezier(.16,1,.3,1) both". Reduced-motion visitors get them switched off.
  updateElement { pageId, elementId, patch: { props?, style?, tablet?, mobile?, hover?, focus?, active?, current?, name?, hidden? } }
      merges; a null value removes a key.
  moveElement { pageId, elementId, parentId, index }
  duplicateElement { pageId, elementId }  -> new element id
  groupElements { pageId, elementIds, frame?: { name?, style? } }  -> frame id. The elements must share a parent.
  removeElement { pageId, elementId }
  setTheme { appNodeId, preset?, colors?: { name: "#hex" }, dark?: { name: "#hex" }, fonts?: { heading?, body?, mono? }, radius?, logo?, favicon? }
      preset starts from paper, ledger, signal, orchard or atelier before the other fields apply. logo and favicon are an
      uploaded asset "asset:<id>/<name>" or an https URL; an image element with src "theme:logo" shows the logo.
      fonts are Google Fonts names, e.g. "Fraunces", "Inter", "JetBrains Mono". dark replaces colors for visitors in dark mode;
      give it its own palette (lighter, desaturated accents and raised surfaces), not an inversion.

  Designing well (drawn from the impeccable and ui-ux-pro-max design guides)
    Start from the subject: its materials, vocabulary and audience pick the palette, type and one signature move. App screens
      take their layout and controls from how people work (a sidebar of views, a list, a detail pane), not from a landing page.
    Spacing on a 4px scale (4 8 12 16 24 32 48 64 96); more space above a heading than below it; group by proximity before
      adding borders or cards. Declare elevation once, a border or a shadow, not both.
    Type: one or two families with a clear scale (e.g. 12 14 16 18 24 32 48 64); body 16px with line height 1.5 to 1.7 and a
      measure of 60 to 75 characters (maxWidth "65ch"); textWrap "balance" on headings; fontVariantNumeric "tabular-nums" for
      prices, counts and tables; mono only for code, ids and keys.
    Contrast at least 4.5:1 for text and 3:1 for large text, icons and focus rings. On a colored surface tint secondary text
      from that hue instead of grey. Controls at least 44px tall on touch screens.
    One primary action per screen. Buttons say what happens ("Add to cart", "Create issue"), sentence case, no arrows appended.
    Icons come from the icon element, never emoji. Every icon-only button gets a label.
    Avoid the generated look: a small all-caps label above every heading, one accented word in a headline, gradient text,
      identical icon-heading-text cards as the whole page, glass as decoration, a thick colored left border on cards, the same
      radius and soft grey shadow on everything, cream with terracotta, near-black with one acid accent.
    Motion: animate one or two things per view, with transform and opacity, 100 to 150ms for feedback, 150 to 300ms for
      routine changes, 300 to 500ms for entrances; exits faster than entrances.
    Empty and error states say what happened and what to do next; errors do not apologize.
  addBlock { pageId, type, props }  -> element id. Adds a block at the end of the page. Data blocks read with props.source = "<serviceNodeId>:<operationName>"; forms write with props.action the same way.
      Block types: navbar, banner, hero, text, features, stats, table (columns: "Title, Done"), grid, detail, kanban, cart, form (fields: "Title, Body", submit), upload, chat, pricing, testimonial, faq, footer.
  updateBlock { pageId, blockId, key, value }
  removeBlock { pageId, blockId }

Environments
  updateEnv { envId, patch: { name?, approval?, scale?, strategy?, target?, backups?: { integration, bucket?, every: "hourly" | "daily" | "weekly", keep } } }
      target: { kind: "docker", server?, host?, domain?, hosts?: { [node]: hostname } } | { kind: "kubernetes", namespace?, registry?, domain?, ingressClass?, publicPort? } | { kind: "git" }
  addEnv { name, provider, region }
  removeEnv { envId }

Generated services implement REST operations as real Postgres queries when the path names a table of a
connected database: GET /notes lists, GET /notes/{id} reads, POST /notes inserts, PATCH or PUT /notes/{id}
updates, DELETE /notes/{id} deletes. Nested paths like /projects/{projectId}/tasks filter by project_id.
Every other operation is generated as a stub that returns 501 with the designed steps as comments.

Users and sign-in: add an auth-service node (its engine defaults to "Built-in (Tessery)") and connect it to a
Postgres. Tessery then generates sign-up, sign-in and session endpoints, a /login page in each web app, and
enforces operations whose auth is "user" or "admin" in TypeScript, Go and Python services. Pages with access
"user" or "admin" require sign-in. Rows of tables with a user_id or owner_id column belong to the user who
created them and are only visible to that user. The first account to sign up becomes an admin.
`
