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
      type and its props:
        frame   { tag?: div|section|header|footer|nav|main|article|aside, href? }  lays out children with style.display flex or grid
        text    { text, tag?: h1|h2|h3|h4|p|span|small|strong|blockquote|label|code }
        button  { text, href }
        image   { src, alt }  src is an https URL or an uploaded asset "asset:<id>/<name>"
        video   { src, poster?, autoplay?, loop?, muted?, controls? }
        shape   { }  a rectangle or, with style.borderRadius "50%", an ellipse
        path    { d, viewBox }  an SVG path in viewBox units; style.stroke, style.strokeWidth and style.fill draw it
        embed   { src, title }  an https iframe such as a video or a map
        block   { block, ...props }  one of the blocks below, with props.source / props.action for data
      style is CSS in camelCase; numbers are pixels for lengths (fontSize: 64, gap: 24). Use theme tokens for color and type:
        var(--c-primary) var(--c-onPrimary) var(--c-text) var(--c-muted) var(--c-bg) var(--c-surface) var(--c-border),
        var(--font-heading) var(--font-body) var(--radius). tablet (900px and below), mobile (600px and below) and hover
        override style; e.g. { style: { gridTemplateColumns: "repeat(3, 1fr)" }, mobile: { gridTemplateColumns: "1fr" } }.
        position "absolute" with left/top places an element freely inside its parent frame.
  updateElement { pageId, elementId, patch: { props?, style?, tablet?, mobile?, hover?, name?, hidden? } }  merges; a null value removes a key.
  moveElement { pageId, elementId, parentId, index }
  duplicateElement { pageId, elementId }  -> new element id
  groupElements { pageId, elementIds, frame?: { name?, style? } }  -> frame id. The elements must share a parent.
  removeElement { pageId, elementId }
  setTheme { appNodeId, colors?: { name: "#hex" }, fonts?: { heading?, body? }, radius? }  fonts are Google Fonts names, e.g. "Fraunces", "Inter".
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
