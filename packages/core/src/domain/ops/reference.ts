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
  addPage { appNodeId, name, route }  -> page id
  addBlock { pageId, type, props }  -> block id. Data blocks read with props.source = "<serviceNodeId>:<operationName>"; forms write with props.action the same way.
      Block types: navbar, hero, text, features, stats, table (columns: "Title, Done"), grid, detail, kanban, form (fields: "Title, Body", submit), footer.
  updateBlock { pageId, blockId, key, value }
  removeBlock { pageId, blockId }

Environments
  updateEnv { envId, patch: { name?, approval?, scale?, strategy?, target? } }
      target: { kind: "docker", host? } | { kind: "kubernetes", namespace?, registry?, domain?, ingressClass?, publicPort? } | { kind: "git" }
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
