import { type Files, type Route, type ServiceModel, comment, envExample, readme, snake, stepLines } from './model'
import PY_DB from '../runtime/py-db.txt'
import PY_SESSION from '../runtime/py-session.txt'
import { builtInAuth } from '../deploy/runtime'
import { ownerColumn } from './typescript'
import { migrationSql, sqlType } from '../backend'
import { type CrudRoute, type DataAccess, columnTypes, dataAccess, orderBy, primaryKey, writable } from './crud'

type Server = 'fastapi' | 'flask' | 'litestar' | 'strawberry' | 'grpc'

function pick(m: ServiceModel): { s: Server; note?: string } {
  if (m.kind !== 'api') return { s: 'fastapi' }
  if (m.style === 'graphql') return { s: 'strawberry', note: m.frameworkId === 'strawberry' ? undefined : `${m.framework} is not generated yet; GraphQL uses Strawberry on FastAPI.` }
  if (m.style === 'grpc') return { s: 'grpc' }
  if (m.frameworkId === 'flask') return { s: 'flask' }
  if (m.frameworkId === 'litestar') return { s: 'litestar' }
  if (m.frameworkId === 'django') return { s: 'fastapi', note: 'Django REST Framework is not generated yet; routes use FastAPI.' }
  return { s: 'fastapi' }
}

const fn = (name: string) => snake(name).replace(/[^a-z0-9_]/g, '_')
const doc = (lines: string[], indent: string) => `${indent}"""${lines[0]}${lines.length > 1 ? `\n\n${lines.slice(1).map((l) => `${indent}${l}`).join('\n')}\n${indent}` : ''}"""`

function config(m: ServiceModel): string {
  return `"""Runtime configuration, read once from the environment."""
import os

PORT = int(os.environ.get("PORT", "${m.port}"))
SERVICE_NAME = os.environ.get("OTEL_SERVICE_NAME", "${m.name}")
DEPENDENCIES = {
${m.deps.map((d) => `    "${d.env}": os.environ.get("${d.env}", "${d.url}"),`).join('\n')}
}
`
}

const tableVar = (name: string) => `${fn(name)}_table`

function pyTables(da?: DataAccess): string {
  if (!da?.routes.length) return ''
  const used = [...new Map(da.routes.map((c) => [c.table.name, c.table])).values()]
  return '\n' + used.map((t) => `${tableVar(t.name)} = db.Table(${JSON.stringify(t.name)}, ${JSON.stringify(primaryKey(t)!.name)}, ${JSON.stringify(columnTypes(t, (c) => sqlType(c, 'pg')))}, ${JSON.stringify(writable(t))}, ${JSON.stringify(orderBy(t))})`).join('\n') + '\n'
}

type Py = 'fastapi' | 'flask' | 'litestar'
const pyGuarded = (m: ServiceModel, r: Route) => !!builtInAuth(m.doc) && (r.op.auth === 'user' || r.op.auth === 'admin')

function pyGuard(m: ServiceModel, r: Route, py: Py): string {
  if (!pyGuarded(m, r)) return ''
  const fail = (status: number, msg: string) => py === 'flask' ? `return jsonify(error="${msg}"), ${status}` : py === 'fastapi' ? `return JSONResponse({"error": "${msg}"}, status_code=${status})` : `return Response({"error": "${msg}"}, status_code=${status})`
  const admin = r.op.auth === 'admin' ? `    if session.get("role") != "admin":\n        ${fail(403, 'forbidden')}\n` : ''
  return `    session = session_from(request.headers)\n    if not session:\n        ${fail(401, 'unauthorized')}\n${admin}`
}

function pyCall(c: CrudRoute, query: string, body: string, owned = false): string {
  const t = tableVar(c.table.name)
  const owner = owned ? ownerColumn(c) : undefined
  const entries = [...(c.parent ? [`${JSON.stringify(c.parent.column)}: ${fn(c.parent.param)}`] : []), ...(owner ? [`${JSON.stringify(owner)}: session["sub"]`] : [])]
  const filter = entries.length ? `, {${entries.join(', ')}}` : ''
  const id = c.idParam ? fn(c.idParam) : ''
  switch (c.action) {
    case 'list': return `${t}.list(${query}${filter})`
    case 'get': return `${t}.get(${id}${filter})`
    case 'create': return `${t}.create(${body}${filter})`
    case 'update': return `${t}.update(${id}, ${body}${filter})`
    case 'delete': return `${t}.remove(${id}${filter})`
  }
}

const crudFor = (da: DataAccess | undefined, r: { name: string }) => da?.routes.find((c) => c.route.name === r.name)

function fastapiMain(m: ServiceModel, ws: boolean, da?: DataAccess): string {
  const routes = m.routes.map((r) => {
    const params = r.params.map((p) => `${fn(p)}: str`)
    const c = crudFor(da, r)
    const g = pyGuard(m, r, 'fastapi')
    if (c) {
      const withBody = c.action === 'create' || c.action === 'update'
      const args = ['request: Request', ...params, ...(withBody ? ['body: dict | None = Body(default=None)'] : [])].join(', ')
      return `@app.${r.method.toLowerCase()}("${r.path.replace(/\{(\w+)\}/g, (_, p: string) => `{${fn(p)}}`)}")
def ${fn(r.name)}(${args}):
${doc(stepLines(r.op), '    ')}
${g}    return result(${pyCall(c, 'request.query_params', 'body', pyGuarded(m, r))})`
    }
    return `@app.${r.method.toLowerCase()}("${r.path.replace(/\{(\w+)\}/g, (_, p: string) => `{${fn(p)}}`)}")
async def ${fn(r.name)}(${[...(g ? ['request: Request'] : []), ...params].join(', ')}):
${doc(stepLines(r.op), '    ')}
${g}    return not_implemented("${r.name}")`
  }).join('\n\n\n')
  const sockets = ws ? `

@app.websocket("${m.spec?.basePath?.startsWith('/') ? m.spec.basePath : '/ws'}")
async def socket(ws: WebSocket):
    await ws.accept()
    while True:
        msg = await ws.receive_json()
        event = msg.get("type")
${m.operations.map((o, i) => `        ${i ? 'elif' : 'if'} event == "${o.kind.split(/\s+/).pop() || o.name}":
${comment(stepLines(o), '#', '            ')}
            await ws.send_json({"type": "error", "error": "not_implemented", "event": event})`).join('\n')}
${m.operations.length ? '        else:\n            ' : '        '}await ws.send_json({"type": "error", "error": "unknown_event", "event": event})` : ''
  const guards = m.routes.some((r) => pyGuarded(m, r))
  return `from fastapi import ${da ? 'Body, ' : ''}FastAPI${da || guards ? ', Request' : ''}${ws ? ', WebSocket' : ''}
from fastapi.responses import JSONResponse${da ? ', Response' : ''}

from . import config${da ? ', db' : ''}${guards ? '\nfrom .session import session_from' : ''}
${da ? '\ndb.migrate()\n' : ''}${pyTables(da)}
app = FastAPI(title=config.SERVICE_NAME)


def not_implemented(operation: str) -> JSONResponse:
    return JSONResponse({"error": "not_implemented", "operation": operation}, status_code=501)
${da ? `

def result(r) -> Response:
    status, body = r
    return Response(status_code=204) if status == 204 else JSONResponse(body, status_code=status)
` : ''}

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


${routes}${sockets}
`
}

function flaskMain(m: ServiceModel, da?: DataAccess): string {
  const guards = m.routes.some((r) => pyGuarded(m, r))
  return `from flask import Flask, jsonify${da || guards ? ', request' : ''}

from . import config${da ? ', db' : ''}${guards ? '\nfrom .session import session_from' : ''}
${da ? '\ndb.migrate()\n' : ''}${pyTables(da)}
app = Flask(config.SERVICE_NAME)
${da ? `

def result(r):
    status, body = r
    return ("", 204) if status == 204 else (jsonify(body), status)
` : ''}

def not_implemented(operation: str):
    return jsonify(error="not_implemented", operation=operation), 501


@app.get("/healthz")
def healthz():
    return {"status": "ok"}

${m.routes.map((r) => {
    const c = crudFor(da, r)
    return `
@app.route("${r.path.replace(/\{(\w+)\}/g, (_, p: string) => `<${fn(p)}>`)}", methods=["${r.method}"])
def ${fn(r.name)}(${r.params.map((p) => fn(p)).join(', ')}):
${doc(stepLines(r.op), '    ')}
${pyGuard(m, r, 'flask')}    return ${c ? `result(${pyCall(c, 'request.args', 'request.get_json(silent=True)', pyGuarded(m, r))})` : `not_implemented("${r.name}")`}
`
  }).join('\n')}`
}

function litestarMain(m: ServiceModel, da?: DataAccess): string {
  return `${da ? 'import asyncio\n' : ''}from typing import Any

from litestar import Litestar, Request, Response, delete, get, patch, post, put

from . import config${da ? ', db' : ''}${m.routes.some((r) => pyGuarded(m, r)) ? '\nfrom .session import session_from' : ''}
${da ? '\ndb.migrate()\n' : ''}${pyTables(da)}
${da ? `
def result(r) -> Response:
    status, body = r
    return Response(None if status == 204 else body, status_code=status)

` : ''}

def not_implemented(operation: str) -> Response:
    return Response({"error": "not_implemented", "operation": operation}, status_code=501)


@get("/healthz")
async def healthz() -> dict:
    return {"status": "ok"}

${m.routes.map((r) => {
    const c = crudFor(da, r)
    if (c) {
      const withBody = c.action === 'create' || c.action === 'update'
      const args = ['request: Request', ...r.params.map((p) => `${fn(p)}: str`), ...(withBody ? ['data: dict[str, Any] | None = None'] : [])].join(', ')
      return `
@${r.method.toLowerCase()}("${r.path.replace(/\{(\w+)\}/g, (_, p: string) => `{${fn(p)}:str}`)}"${r.method === 'DELETE' ? ', status_code=200' : ''})
async def ${fn(r.name)}(${args}) -> Response:
${doc(stepLines(r.op), '    ')}
${pyGuard(m, r, 'litestar')}    return result(await asyncio.to_thread(lambda: ${pyCall(c, 'request.query_params', 'data', pyGuarded(m, r))}))
`
    }
    return `
@${r.method.toLowerCase()}("${r.path.replace(/\{(\w+)\}/g, (_, p: string) => `{${fn(p)}:str}`)}"${r.method === 'DELETE' ? ', status_code=501' : ''})
async def ${fn(r.name)}(${[...(pyGuarded(m, r) ? ['request: Request'] : []), ...r.params.map((p) => `${fn(p)}: str`)].join(', ')}) -> Response:
${doc(stepLines(r.op), '    ')}
${pyGuard(m, r, 'litestar')}    return not_implemented("${r.name}")
`
  }).join('\n')}

app = Litestar(route_handlers=[healthz${m.routes.map((r) => `, ${fn(r.name)}`).join('')}])
`
}

function strawberryMain(m: ServiceModel): string {
  const field = (o: (typeof m.operations)[number]) => `    @strawberry.field
    def ${fn(o.name)}(self) -> str:
${doc(stepLines(o), '        ')}
        raise NotImplementedError("${o.name}")`
  const q = m.operations.filter((o) => o.kind.toLowerCase() === 'query')
  const mu = m.operations.filter((o) => o.kind.toLowerCase() === 'mutation')
  return `"""GraphQL API. The designed schema is in schema.graphql; these resolvers are typed placeholders to fill in."""
import strawberry
from fastapi import FastAPI
from strawberry.fastapi import GraphQLRouter

from . import config


@strawberry.type
class Query:
${q.length ? q.map(field).join('\n\n') : '    @strawberry.field\n    def ping(self) -> str:\n        return "pong"'}

${mu.length ? `
@strawberry.type
class Mutation:
${mu.map((o) => field(o).replace('@strawberry.field', '@strawberry.mutation')).join('\n\n')}
` : ''}
schema = strawberry.Schema(query=Query${mu.length ? ', mutation=Mutation' : ''})
app = FastAPI(title=config.SERVICE_NAME)
app.include_router(GraphQLRouter(schema), prefix="/graphql")


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
`
}

function grpcMain(m: ServiceModel, proto: string, svc: string): string {
  return `"""gRPC server. Stubs are generated from proto/${proto}.proto when the image is built."""
import sys
import threading
from concurrent import futures
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import grpc

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "gen"))
import ${proto}_pb2_grpc as rpc  # noqa: E402

from . import config  # noqa: E402


class ${svc}(rpc.${svc}Servicer):
${m.operations.map((o) => `    def ${o.name}(self, request, context):
${doc(stepLines(o), '        ')}
        context.abort(grpc.StatusCode.UNIMPLEMENTED, "${o.name} is not implemented yet")`).join('\n\n') || '    pass'}


class Health(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *args):
        pass


def main():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=16))
    rpc.add_${svc}Servicer_to_server(${svc}(), server)
    server.add_insecure_port(f"0.0.0.0:{config.PORT}")
    server.start()
    threading.Thread(target=HTTPServer(("0.0.0.0", config.PORT + 1), Health).serve_forever, daemon=True).start()
    server.wait_for_termination()


if __name__ == "__main__":
    main()
`
}

function workerMain(m: ServiceModel): string {
  if (m.kind === 'cron') return `"""Runs once per schedule (${m.schedule}); the platform starts the container on that schedule."""
from . import config


def main():
    print("${m.name} started", sorted(config.DEPENDENCIES))


if __name__ == "__main__":
    main()
`
  return `"""Consumes work from: ${m.sources.join(', ') || 'nothing connected yet'}. Replace next_job with the client for that source."""
import asyncio
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

from . import config


async def next_job():
    await asyncio.sleep(1)
    return None


async def handle(job):
    print("received job", job)


async def loop():
    while True:
        job = await next_job()
        if job is not None:
            await handle(job)


class Health(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/healthz" else 404)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *args):
        pass


async def main():
    threading.Thread(target=HTTPServer(("0.0.0.0", config.PORT), Health).serve_forever, daemon=True).start()
    concurrency = int(os.environ.get("CONCURRENCY", "${m.concurrency}"))
    await asyncio.gather(*(loop() for _ in range(max(concurrency, 1))))


if __name__ == "__main__":
    asyncio.run(main())
`
}

export function pythonService(m: ServiceModel, contracts: { proto: string; svc?: string }): Files {
  const { s, note } = pick(m)
  const f: Files = {}
  const pkg = `${m.dir}/app`
  f[`${pkg}/__init__.py`] = ''
  f[`${pkg}/config.py`] = config(m)
  const deps = ['opentelemetry-distro>=0.50b0', 'opentelemetry-exporter-otlp>=1.29']
  const da = m.kind === 'api' && (s === 'fastapi' || s === 'flask' || s === 'litestar') ? dataAccess(m) : undefined
  if (m.kind === 'api' && (s === 'fastapi' || s === 'flask' || s === 'litestar') && m.routes.some((r) => pyGuarded(m, r))) f[`${pkg}/session.py`] = PY_SESSION
  if (da) {
    deps.push('psycopg[binary]>=3.2', 'psycopg-pool>=3.2')
    f[`${m.dir}/migrations/${da.file}`] = migrationSql(da.schema, da.node.techId)
    f[`${pkg}/db.py`] = PY_DB.replace('__DB_ENV__', da.dep.env).replace('__SCHEMA_FILE__', da.file)
  }
  let cmd: string
  if (m.kind !== 'api') {
    f[`${pkg}/main.py`] = workerMain(m)
    cmd = 'python -m app.main'
  } else if (s === 'grpc') {
    deps.push('grpcio>=1.70', 'grpcio-tools>=1.70', 'protobuf>=5')
    f[`${pkg}/main.py`] = grpcMain(m, contracts.proto, contracts.svc ?? 'Service')
    cmd = 'python -m app.main'
  } else if (s === 'flask') {
    deps.push('flask>=3.1', 'gunicorn>=23')
    f[`${pkg}/main.py`] = flaskMain(m, da)
    cmd = `gunicorn -b 0.0.0.0:$PORT app.main:app`
  } else if (s === 'litestar') {
    deps.push('litestar>=2.15', 'uvicorn>=0.34')
    f[`${pkg}/main.py`] = litestarMain(m, da)
    cmd = 'uvicorn app.main:app --host 0.0.0.0 --port $PORT'
  } else {
    deps.push('fastapi>=0.115', 'uvicorn[standard]>=0.34')
    if (s === 'strawberry') deps.push('strawberry-graphql[fastapi]>=0.260')
    f[`${pkg}/main.py`] = s === 'strawberry' ? strawberryMain(m) : fastapiMain(m, m.style === 'websocket', da)
    cmd = 'uvicorn app.main:app --host 0.0.0.0 --port $PORT'
  }
  f[`${m.dir}/pyproject.toml`] = `[project]
name = "${m.name}"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
${deps.map((d) => `    "${d}",`).join('\n')}
]

[tool.setuptools]
packages = ["app"]
`
  const protoc = s === 'grpc' && m.kind === 'api' ? `RUN mkdir -p gen && python -m grpc_tools.protoc -Iproto --python_out=gen --grpc_python_out=gen proto/${contracts.proto}.proto\n` : ''
  f[`${m.dir}/Dockerfile`] = `FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PORT=${m.port}
COPY . .
RUN pip install --no-cache-dir . && opentelemetry-bootstrap -a install
${protoc}RUN useradd --system --uid 10001 app
USER app
EXPOSE ${m.port}
CMD ["sh", "-c", "exec \${OTEL_EXPORTER_OTLP_ENDPOINT:+opentelemetry-instrument} ${cmd}"]
`
  f[`${m.dir}/.dockerignore`] = '__pycache__\n.venv\n'
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, `pip install . && ${cmd.replace('$PORT', String(m.port))}`, note ? [note] : [])
  return f
}
