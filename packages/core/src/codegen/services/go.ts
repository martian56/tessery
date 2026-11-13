import GO_DB from '../runtime/go-db.txt'
import GO_SESSION from '../runtime/go-session.txt'
import { builtInAuth } from '../deploy/runtime'
import { ownerColumn } from './typescript'
import { sqlType } from '../backend'
import { type Files, type Route, type ServiceModel, camel, comment, envExample, ident, pascal, readme, stepLines } from './model'
import { type CrudRoute, type DataAccess, columnTypes, dataAccess, orderBy, primaryKey, writable } from './crud'

type Router = 'chi' | 'gin' | 'echo'

function router(m: ServiceModel): { r: Router; note?: string } {
  if (m.frameworkId === 'gin') return { r: 'gin' }
  if (m.frameworkId === 'echo') return { r: 'echo' }
  if (m.kind === 'api' && ['grpc-go', 'connect-go', 'gqlgen', 'gorilla-ws'].includes(m.frameworkId)) {
    return { r: 'chi', note: `${m.framework} code is not generated yet. The ${m.style === 'grpc' ? 'proto' : m.style === 'graphql' ? 'schema' : 'contract'} is included; HTTP routes and health use chi.` }
  }
  return { r: 'chi' }
}

const IMPORTS: Record<Router, string> = { chi: 'github.com/go-chi/chi/v5', gin: 'github.com/gin-gonic/gin', echo: 'github.com/labstack/echo/v4' }

const goMap = (o: Record<string, string>) => `map[string]string{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}`
const tableVar = (name: string) => `${camel(name)}Table`

function goTables(da?: DataAccess): string {
  if (!da?.routes.length) return ''
  const used = [...new Map(da.routes.map((c) => [c.table.name, c.table])).values()]
  return used.map((t) => `var ${tableVar(t.name)} = Table{Name: ${JSON.stringify(t.name)}, Key: ${JSON.stringify(primaryKey(t)!.name)}, Order: ${JSON.stringify(orderBy(t))}, Types: ${goMap(columnTypes(t, (c) => sqlType(c, 'pg')))}, Writable: []string{${writable(t).map((w) => JSON.stringify(w)).join(', ')}}}`).join('\n') + '\n\n'
}

const goGuarded = (m: ServiceModel, rt: Route) => !!builtInAuth(m.doc) && (rt.op.auth === 'user' || rt.op.auth === 'admin')

function goGuard(m: ServiceModel, rt: Route, r: Router, c?: CrudRoute): string {
  if (!goGuarded(m, rt)) return ''
  const req = r === 'chi' ? 'r' : r === 'gin' ? 'c.Request' : 'c.Request()'
  const fail = (status: string, msg: string) => r === 'chi'
    ? `writeJSON(w, http.${status}, map[string]string{"error": "${msg}"})\n\t\treturn`
    : r === 'gin' ? `c.JSON(http.${status}, gin.H{"error": "${msg}"})\n\t\treturn` : `return c.JSON(http.${status}, map[string]string{"error": "${msg}"})`
  const keep = rt.op.auth === 'admin' || (!!c && !!ownerColumn(c))
  const head = keep
    ? `\tsession := sessionFrom(${req})\n\tif session == nil {\n\t\t${fail('StatusUnauthorized', 'unauthorized')}\n\t}\n`
    : `\tif sessionFrom(${req}) == nil {\n\t\t${fail('StatusUnauthorized', 'unauthorized')}\n\t}\n`
  const admin = rt.op.auth === 'admin' ? `\tif session.Role != "admin" {\n\t\t${fail('StatusForbidden', 'forbidden')}\n\t}\n` : ''
  return head + admin
}

function goCall(c: CrudRoute, r: Router, owned = false): string {
  const name = (p: string) => JSON.stringify(paramName(c.route, p))
  const param = (p: string) => (r === 'chi' ? `chi.URLParam(r, ${name(p)})` : `c.Param(${name(p)})`)
  const ctx = r === 'chi' ? 'r.Context()' : r === 'gin' ? 'c.Request.Context()' : 'c.Request().Context()'
  const query = r === 'chi' ? 'r.URL.Query()' : r === 'gin' ? 'c.Request.URL.Query()' : 'c.QueryParams()'
  const body = r === 'chi' ? 'readBody(r.Body)' : r === 'gin' ? 'readBody(c.Request.Body)' : 'readBody(c.Request().Body)'
  const owner = owned ? ownerColumn(c) : undefined
  const entries = [...(c.parent ? [`${JSON.stringify(c.parent.column)}: ${param(c.parent.param)}`] : []), ...(owner ? [`${JSON.stringify(owner)}: session.Sub`] : [])]
  const filter = entries.length ? `map[string]string{${entries.join(', ')}}` : 'nil'
  const id = c.idParam ? param(c.idParam) : ''
  const t = tableVar(c.table.name)
  switch (c.action) {
    case 'list': return `${t}.List(${ctx}, ${query}, ${filter})`
    case 'get': return `${t}.Get(${ctx}, ${id}, ${filter})`
    case 'create': return `${t}.Create(${ctx}, ${body}, ${filter})`
    case 'update': return `${t}.Update(${ctx}, ${id}, ${body}, ${filter})`
    case 'delete': return `${t}.Remove(${ctx}, ${id}, ${filter})`
  }
}

function handlers(m: ServiceModel, r: Router, da?: DataAccess): string {
  return m.routes.map((rt) => {
    const fn = pascal(rt.name)
    const doc = comment(stepLines(rt.op), '//', '\t')
    const c = da?.routes.find((x) => x.route === rt)
    const g = goGuard(m, rt, r, c)
    const owned = goGuarded(m, rt)
    if (c) {
      if (r === 'gin') return `func ${fn}(c *gin.Context) {\n${doc}\n${g}\tsend(c, ${goCall(c, r, owned)})\n}`
      if (r === 'echo') return `func ${fn}(c echo.Context) error {\n${doc}\n${g}\treturn send(c, ${goCall(c, r, owned)})\n}`
      return `func ${fn}(w http.ResponseWriter, r *http.Request) {\n${doc}\n${g}\trespond(w, ${goCall(c, r, owned)})\n}`
    }
    if (r === 'gin') return `func ${fn}(c *gin.Context) {\n${doc}\n${g}\tc.JSON(http.StatusNotImplemented, gin.H{"error": "not_implemented", "operation": "${rt.name}"})\n}`
    if (r === 'echo') return `func ${fn}(c echo.Context) error {\n${doc}\n${g}\treturn c.JSON(http.StatusNotImplemented, map[string]string{"error": "not_implemented", "operation": "${rt.name}"})\n}`
    return `func ${fn}(w http.ResponseWriter, ${g ? 'r' : '_'} *http.Request) {\n${doc}\n${g}\twriteJSON(w, http.StatusNotImplemented, map[string]string{"error": "not_implemented", "operation": "${rt.name}"})\n}`
  }).join('\n\n')
}

const renames = new WeakMap<Route, Record<string, string>>()

function canonicalize(all: Route[]) {
  const seen = new Map<string, string>()
  for (const rt of all) {
    const names: Record<string, string> = {}
    let prefix = ''
    for (const seg of rt.path.split('/').filter(Boolean)) {
      const m = /^\{(\w+)\}$/.exec(seg)
      if (!m) { prefix += `/${seg}`; continue }
      prefix += '/{}'
      if (!seen.has(prefix)) seen.set(prefix, m[1])
      names[m[1]] = seen.get(prefix)!
    }
    renames.set(rt, names)
  }
}

const paramName = (rt: Route, p: string) => renames.get(rt)?.[p] ?? p

function routes(m: ServiceModel, r: Router): string {
  const path = (rt: Route) => {
    const renamed = rt.path.replace(/\{(\w+)\}/g, (_, p: string) => `{${paramName(rt, p)}}`)
    return r === 'chi' ? renamed : renamed.replace(/\{(\w+)\}/g, ':$1')
  }
  const reg = m.routes.map((rt) => {
    const method = rt.method[0] + rt.method.slice(1).toLowerCase()
    if (r === 'chi') return `\tr.${method}("${path(rt)}", ${pascal(rt.name)})`
    return `\tr.${rt.method}("${path(rt)}", ${pascal(rt.name)})`
  }).join('\n')
  if (r === 'gin') return `func newRouter() http.Handler {\n\tgin.SetMode(gin.ReleaseMode)\n\tr := gin.New()\n\tr.Use(gin.Recovery())\n\tr.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })\n${reg}\n\treturn r\n}`
  if (r === 'echo') return `func newRouter() http.Handler {\n\tr := echo.New()\n\tr.HideBanner = true\n\tr.GET("/healthz", func(c echo.Context) error { return c.JSON(http.StatusOK, map[string]string{"status": "ok"}) })\n${reg}\n\treturn r\n}`
  return `func newRouter() http.Handler {\n\tr := chi.NewRouter()\n\tr.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]string{"status": "ok"}) })\n${reg}\n\treturn r\n}\n\nfunc writeJSON(w http.ResponseWriter, status int, v any) {\n\tw.Header().Set("Content-Type", "application/json")\n\tw.WriteHeader(status)\n\t_ = json.NewEncoder(w).Encode(v)\n}`
}

const TELEMETRY = `package main

import (
	"context"
	"net/http"
	"os"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// setupTelemetry exports traces when OTEL_EXPORTER_OTLP_ENDPOINT is set and otherwise does nothing.
func setupTelemetry(ctx context.Context) func(context.Context) error {
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return func(context.Context) error { return nil }
	}
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		return func(context.Context) error { return nil }
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))
	otel.SetTracerProvider(tp)
	// Join traces started by callers instead of starting a new one for every request.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown
}

func instrument(h http.Handler, name string) http.Handler {
	return otelhttp.NewHandler(h, name)
}
`

export function goService(m: ServiceModel): Files {
  const { r, note } = router(m)
  const da = m.kind === 'api' ? dataAccess(m) : undefined
  canonicalize(m.routes)
  const mod = `example.com/${ident(m.name)}`
  const f: Files = {}
  const cfg = `package main

import "os"

type Config struct {
	Port         string
	ServiceName  string
	Dependencies map[string]string
}

func loadConfig() Config {
	return Config{
		Port:        env("PORT", "${m.port}"),
		ServiceName: env("OTEL_SERVICE_NAME", "${m.name}"),
		Dependencies: map[string]string{
${m.deps.map((d) => `\t\t\t"${d.env}": env("${d.env}", "${d.url}"),`).join('\n')}
		},
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
`
  const dir = `${m.dir}/cmd/${m.name}`
  f[`${dir}/config.go`] = cfg
  f[`${dir}/telemetry.go`] = TELEMETRY

  if (m.kind === 'api') {
    f[`${dir}/main.go`] = `package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	shutdown := setupTelemetry(ctx)
	defer shutdown(context.Background())
${da ? `	openDB(ctx, cfg.Dependencies[${JSON.stringify(da.dep.env)}])
` : ''}
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: instrument(newRouter(), cfg.ServiceName), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	sctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
}
`
    const imports = ['"net/http"', r === 'chi' ? '"encoding/json"' : '', `"${IMPORTS[r]}"`].filter(Boolean)
    const sender = !da?.routes.length ? '' : r === 'gin'
      ? 'func send(c *gin.Context, res Result) {\n\tif res.Status == http.StatusNoContent {\n\t\tc.Status(res.Status)\n\t\treturn\n\t}\n\tc.Data(res.Status, "application/json", res.Body)\n}\n\n'
      : r === 'echo'
        ? 'func send(c echo.Context, res Result) error {\n\tif res.Status == http.StatusNoContent {\n\t\treturn c.NoContent(res.Status)\n\t}\n\treturn c.Blob(res.Status, "application/json", res.Body)\n}\n\n'
        : 'func respond(w http.ResponseWriter, res Result) {\n\tif res.Status != http.StatusNoContent {\n\t\tw.Header().Set("Content-Type", "application/json")\n\t}\n\tw.WriteHeader(res.Status)\n\t_, _ = w.Write(res.Body)\n}\n\n'
    f[`${dir}/routes.go`] = `package main

import (
${imports.map((i) => `\t${i}`).join('\n')}
)

${routes(m, r)}

${goTables(da)}${sender}${handlers(m, r, da)}
`
    if (m.routes.some((rt) => goGuarded(m, rt))) f[`${dir}/session.go`] = GO_SESSION
    if (da) {
      f[`${dir}/db.go`] = GO_DB.replace('__MIGRATIONS_DIR__', da.node.name)
      for (const mg of da.migrations) f[`${dir}/migrations/${da.node.name}/${mg.file}`] = mg.sql
    }
  } else {
    f[`${dir}/main.go`] = m.kind === 'cron'
      ? `package main

import (
	"context"
	"log"
)

// Runs once per schedule (${m.schedule}); the platform starts the container on that schedule.
func main() {
	cfg := loadConfig()
	shutdown := setupTelemetry(context.Background())
	defer shutdown(context.Background())
	log.Printf("${m.name} started with %d dependencies", len(cfg.Dependencies))
}
`
      : `package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

// Consumes work from: ${m.sources.join(', ') || 'nothing connected yet'}. Replace nextJob with the client for that source.
func nextJob(ctx context.Context) (any, bool) {
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
	}
	return nil, false
}

func handle(job any) {
	log.Printf("received job %v", job)
}

func main() {
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	shutdown := setupTelemetry(ctx)
	defer shutdown(context.Background())

	workers, _ := strconv.Atoi(env("CONCURRENCY", "${m.concurrency}"))
	for i := 0; i < max(workers, 1); i++ {
		go func() {
			for ctx.Err() == nil {
				if job, ok := nextJob(ctx); ok {
					handle(job)
				}
			}
		}()
	}
	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(\`{"status":"ok"}\`)) })
	go func() { _ = http.ListenAndServe(":"+cfg.Port, nil) }()
	<-ctx.Done()
}
`
  }

  f[`${m.dir}/go.mod`] = `module ${mod}\n\ngo 1.26\n`
  f[`${m.dir}/Dockerfile`] = `FROM golang:1.26-alpine AS build
WORKDIR /src
COPY . .
RUN go mod tidy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/${m.name}

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
EXPOSE ${m.port}
ENTRYPOINT ["/app"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, `go mod tidy && go run ./cmd/${m.name}`, note ? [note] : [])
  return f
}
