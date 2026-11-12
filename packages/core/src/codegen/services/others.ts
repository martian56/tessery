import { type Files, type ServiceModel, comment, envExample, ident, pascal, readme, snake, stepLines } from './model'

const unsupportedStyle = (m: ServiceModel, lang: string) =>
  m.kind === 'api' && !['rest', 'webhook', 'sse'].includes(m.style) ? [`${m.style} handlers are not generated for ${lang} yet; the contract is included and HTTP routes and health are served.`] : []

const fallback = (m: ServiceModel, supported: string[], used: string) =>
  m.frameworkId && !supported.includes(m.frameworkId) ? [`${m.framework} is not generated yet; this service uses ${used}.`] : []

export function csharpService(m: ServiceModel): Files {
  const proj = pascal(ident(m.name))
  const f: Files = {}
  f[`${m.dir}/${proj}.csproj`] = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>App</AssemblyName>
  </PropertyGroup>
</Project>
`
  f[`${m.dir}/Program.cs`] = `var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{Environment.GetEnvironmentVariable("PORT") ?? "${m.port}"}");
var app = builder.Build();

static string Env(string key, string fallback) => Environment.GetEnvironmentVariable(key) is { Length: > 0 } v ? v : fallback;

// Connection URLs for the services this one depends on.
var dependencies = new Dictionary<string, string>
{
${m.deps.map((d) => `    ["${d.env}"] = Env("${d.env}", "${d.url}"),`).join('\n')}
};
app.Logger.LogInformation("${m.name} starting with {Count} dependencies", dependencies.Count);

app.MapGet("/healthz", () => Results.Json(new { status = "ok" }));
${m.kind === 'api' ? m.routes.map((r) => `
${comment(stepLines(r.op), '//')}
app.Map${pascal(r.method.toLowerCase())}("${r.path}", () => Results.Json(new { error = "not_implemented", operation = "${r.name}" }, statusCode: 501));`).join('\n') : `
${m.kind === 'cron' ? `// Runs once per schedule (${m.schedule}); the platform starts the container on that schedule.\nreturn;` : `// Worker: consumes from ${m.sources.join(', ') || 'nothing connected yet'}. Add a BackgroundService for that source.`}`}

app.Run();
`
  f[`${m.dir}/Dockerfile`] = `FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
USER app
EXPOSE ${m.port}
ENTRYPOINT ["dotnet", "App.dll"]
`
  f[`${m.dir}/.dockerignore`] = 'bin\nobj\n'
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'dotnet run', [...fallback(m, ['aspnet'], 'ASP.NET Core minimal APIs'), ...unsupportedStyle(m, 'C#')])
  return f
}

export function rubyService(m: ServiceModel): Files {
  const f: Files = {}
  f[`${m.dir}/Gemfile`] = `source "https://rubygems.org"\n\ngem "sinatra", "~> 4.1"\ngem "puma", "~> 6.6"\ngem "rackup", "~> 2.2"\n`
  f[`${m.dir}/app.rb`] = `require "sinatra/base"
require "json"

class App < Sinatra::Base
  set :host_authorization, { permitted_hosts: [] }

  # Connection URLs for the services this one depends on.
  DEPENDENCIES = {
${m.deps.map((d) => `    "${d.env}" => ENV.fetch("${d.env}", "${d.url}"),`).join('\n')}
  }.freeze

  before { content_type :json }

  get "/healthz" do
    { status: "ok" }.to_json
  end
${m.routes.map((r) => `
${comment(stepLines(r.op), '#', '  ')}
  ${r.method.toLowerCase()} "${r.path.replace(/\{(\w+)\}/g, ':$1')}" do
    halt 501, { error: "not_implemented", operation: "${r.name}" }.to_json
  end`).join('\n')}
end
`
  f[`${m.dir}/config.ru`] = `require_relative "app"\nrun App\n`
  f[`${m.dir}/Dockerfile`] = `FROM ruby:3.4-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY Gemfile ./
RUN bundle install
COPY . .
RUN useradd --system --uid 10001 app
USER app
ENV PORT=${m.port}
EXPOSE ${m.port}
CMD ["sh", "-c", "exec bundle exec puma -b tcp://0.0.0.0:$PORT config.ru"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'bundle install && bundle exec puma config.ru', [...fallback(m, ['sinatra'], 'Sinatra'), ...unsupportedStyle(m, 'Ruby')])
  return f
}

export function phpService(m: ServiceModel): Files {
  const f: Files = {}
  const rx = (p: string) => '#^' + p.replace(/\{(\w+)\}/g, '(?P<$1>[^/]+)') + '$#'
  f[`${m.dir}/public/index.php`] = `<?php
declare(strict_types=1);

function env_or(string $key, string $fallback): string {
    $v = getenv($key);
    return $v === false || $v === '' ? $fallback : $v;
}

/** Connection URLs for the services this one depends on. */
$dependencies = [
${m.deps.map((d) => `    '${d.env}' => env_or('${d.env}', '${d.url.replace(/'/g, "\\'")}'),`).join('\n')}
];

function respond(int $status, array $body): void {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($body);
}

$method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';

if ($method === 'GET' && $path === '/healthz') {
    respond(200, ['status' => 'ok']);
    return;
}

$routes = [
${m.routes.map((r) => `    // ${stepLines(r.op).join(' | ')}
    ['${r.method}', '${rx(r.path)}', '${r.name}'],`).join('\n')}
];

foreach ($routes as [$m, $pattern, $operation]) {
    if ($m === $method && preg_match($pattern, $path)) {
        respond(501, ['error' => 'not_implemented', 'operation' => $operation]);
        return;
    }
}
respond(404, ['error' => 'not_found']);
`
  f[`${m.dir}/Dockerfile`] = `FROM php:8.4-cli
WORKDIR /app
COPY . .
RUN useradd --system --uid 10001 app
USER app
ENV PORT=${m.port}
EXPOSE ${m.port}
CMD ["sh", "-c", "exec php -S 0.0.0.0:$PORT -t public public/index.php"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, `php -S 0.0.0.0:${m.port} -t public public/index.php`, [...(m.frameworkId ? [`${m.framework} is not generated yet; this service is a dependency-free PHP front controller.`] : []), ...unsupportedStyle(m, 'PHP')])
  return f
}

export function elixirService(m: ServiceModel): Files {
  const app = snake(ident(m.name))
  const mod = pascal(ident(m.name))
  const f: Files = {}
  f[`${m.dir}/mix.exs`] = `defmodule ${mod}.MixProject do
  use Mix.Project

  def project do
    [app: :${app}, version: "0.1.0", elixir: "~> 1.17", start_permanent: Mix.env() == :prod, deps: deps()]
  end

  def application do
    [extra_applications: [:logger], mod: {${mod}.Application, []}]
  end

  defp deps do
    [{:bandit, "~> 1.6"}, {:jason, "~> 1.4"}]
  end
end
`
  f[`${m.dir}/lib/${app}/application.ex`] = `defmodule ${mod}.Application do
  use Application

  @impl true
  def start(_type, _args) do
    port = String.to_integer(System.get_env("PORT", "${m.port}"))
    Supervisor.start_link([{Bandit, plug: ${mod}.Router, ip: {0, 0, 0, 0}, port: port}], strategy: :one_for_one, name: ${mod}.Supervisor)
  end
end
`
  f[`${m.dir}/lib/${app}/router.ex`] = `defmodule ${mod}.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  @doc "Connection URLs for the services this one depends on."
  def dependencies do
    %{
${m.deps.map((d) => `      "${d.env}" => System.get_env("${d.env}", "${d.url}"),`).join('\n')}
    }
  end

  defp json(conn, status, body), do: conn |> put_resp_content_type("application/json") |> send_resp(status, Jason.encode!(body))

  get "/healthz" do
    json(conn, 200, %{status: "ok"})
  end
${m.routes.map((r) => `
${comment(stepLines(r.op), '#', '  ')}
  ${r.method.toLowerCase()} "${r.path.replace(/\{(\w+)\}/g, ':$1')}" do
    json(conn, 501, %{error: "not_implemented", operation: "${r.name}"})
  end`).join('\n')}

  match _ do
    json(conn, 404, %{error: "not_found"})
  end
end
`
  f[`${m.dir}/Dockerfile`] = `FROM elixir:1.18
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force
COPY mix.exs ./
RUN mix deps.get --only prod && mix deps.compile
COPY . .
RUN mix compile
EXPOSE ${m.port}
CMD ["mix", "run", "--no-halt"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'mix deps.get && mix run --no-halt', [...(m.frameworkId ? [`${m.framework} is not generated yet; this service uses Plug on Bandit.`] : []), ...unsupportedStyle(m, 'Elixir')])
  return f
}

export function swiftService(m: ServiceModel): Files {
  const f: Files = {}
  const segs = (p: string) => p.split('/').filter(Boolean).map((s) => (/^\{\w+\}$/.test(s) ? `":${s.slice(1, -1)}"` : `"${s}"`)).join(', ')
  f[`${m.dir}/Package.swift`] = `// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "App",
    platforms: [.macOS(.v13)],
    dependencies: [.package(url: "https://github.com/vapor/vapor.git", from: "4.110.0")],
    targets: [.executableTarget(name: "App", dependencies: [.product(name: "Vapor", package: "vapor")])]
)
`
  f[`${m.dir}/Sources/App/entrypoint.swift`] = `import Vapor

/// Connection URLs for the services this one depends on.
let dependencies: [String: String] = [
${m.deps.map((d) => `    "${d.env}": Environment.get("${d.env}") ?? "${d.url}",`).join('\n')}
]

func notImplemented(_ operation: String) -> Response {
    Response(status: .notImplemented, headers: ["content-type": "application/json"], body: .init(string: #"{"error":"not_implemented","operation":"\\#(operation)"}"#))
}

@main
enum Entrypoint {
    static func main() async throws {
        let app = try await Application.make(.detect())
        app.http.server.configuration.hostname = "0.0.0.0"
        app.http.server.configuration.port = Int(Environment.get("PORT") ?? "${m.port}") ?? ${m.port}
        app.get("healthz") { _ in Response(status: .ok, headers: ["content-type": "application/json"], body: .init(string: #"{"status":"ok"}"#)) }
${m.routes.map((r) => `${comment(stepLines(r.op), '//', '        ')}
        app.on(.${r.method}, ${segs(r.path) || '""'}) { _ in notImplemented("${r.name}") }`).join('\n')}
        try await app.execute()
        try await app.asyncShutdown()
    }
}
`
  f[`${m.dir}/Dockerfile`] = `FROM swift:6.1 AS build
WORKDIR /src
COPY . .
RUN swift build -c release --static-swift-stdlib && cp "$(swift build -c release --show-bin-path)/App" /app

FROM debian:trixie-slim
RUN useradd --system --uid 10001 app
COPY --from=build /app /usr/local/bin/app
USER app
EXPOSE ${m.port}
ENTRYPOINT ["/usr/local/bin/app", "serve", "--env", "production"]
`
  f[`${m.dir}/.dockerignore`] = '.build\n'
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'swift run App serve', unsupportedStyle(m, 'Swift'))
  return f
}

export function cppService(m: ServiceModel): Files {
  const f: Files = {}
  const rx = (p: string) => p.replace(/\{(\w+)\}/g, '([^/]+)')
  f[`${m.dir}/CMakeLists.txt`] = `cmake_minimum_required(VERSION 3.24)
project(app CXX)
set(CMAKE_CXX_STANDARD 20)
include(FetchContent)
FetchContent_Declare(httplib GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git GIT_TAG v0.20.1 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(httplib)
add_executable(app src/main.cpp)
target_link_libraries(app PRIVATE httplib::httplib)
`
  f[`${m.dir}/src/main.cpp`] = `#include <cstdlib>
#include <iostream>
#include <map>
#include <string>
#include "httplib.h"

static std::string env_or(const char* key, const std::string& fallback) {
    const char* v = std::getenv(key);
    return v && *v ? v : fallback;
}

static void not_implemented(httplib::Response& res, const std::string& operation) {
    res.status = 501;
    res.set_content(R"({"error":"not_implemented","operation":")" + operation + R"("})", "application/json");
}

int main() {
    // Connection URLs for the services this one depends on.
    const std::map<std::string, std::string> dependencies = {
${m.deps.map((d) => `        {"${d.env}", env_or("${d.env}", "${d.url}")},`).join('\n')}
    };
    httplib::Server server;
    server.Get("/healthz", [](const httplib::Request&, httplib::Response& res) { res.set_content(R"({"status":"ok"})", "application/json"); });
${m.routes.map((r) => `${comment(stepLines(r.op), '//', '    ')}
    server.${pascal(r.method.toLowerCase())}(R"(${rx(r.path)})", [](const httplib::Request&, httplib::Response& res) { not_implemented(res, "${r.name}"); });`).join('\n')}
    const int port = std::stoi(env_or("PORT", "${m.port}"));
    std::cout << "listening on " << port << " with " << dependencies.size() << " dependencies" << std::endl;
    server.listen("0.0.0.0", port);
}
`
  f[`${m.dir}/Dockerfile`] = `FROM gcc:14 AS build
RUN apt-get update && apt-get install -y --no-install-recommends cmake && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j

FROM debian:trixie-slim
RUN useradd --system --uid 10001 app
COPY --from=build /src/build/app /usr/local/bin/app
USER app
EXPOSE ${m.port}
ENTRYPOINT ["/usr/local/bin/app"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'cmake -S . -B build && cmake --build build && ./build/app', [...(m.frameworkId ? [`${m.framework} is not generated yet; this service uses cpp-httplib.`] : []), ...unsupportedStyle(m, 'C++')])
  return f
}

export function zigService(m: ServiceModel): Files {
  const f: Files = {}
  f[`${m.dir}/build.zig`] = `const std = @import("std");

pub fn build(b: *std.Build) void {
    const exe = b.addExecutable(.{
        .name = "app",
        .root_source_file = b.path("src/main.zig"),
        .target = b.standardTargetOptions(.{}),
        .optimize = b.standardOptimizeOption(.{}),
    });
    b.installArtifact(exe);
}
`
  f[`${m.dir}/src/main.zig`] = `const std = @import("std");

const json = [_]std.http.Header{.{ .name = "content-type", .value = "application/json" }};

const Route = struct { method: std.http.Method, pattern: []const u8, operation: []const u8 };

const routes = [_]Route{
${m.routes.map((r) => `    // ${stepLines(r.op).join(' | ')}
    .{ .method = .${r.method}, .pattern = "${r.path}", .operation = "${r.name}" },`).join('\n')}
};

/// Matches a path against a pattern where \`{name}\` segments match any single segment.
fn matches(pattern: []const u8, path: []const u8) bool {
    var p = std.mem.splitScalar(u8, pattern, '/');
    var t = std.mem.splitScalar(u8, path, '/');
    while (true) {
        const a = p.next();
        const b = t.next();
        if (a == null and b == null) return true;
        if (a == null or b == null) return false;
        if (a.?.len > 0 and a.?[0] == '{') continue;
        if (!std.mem.eql(u8, a.?, b.?)) return false;
    }
}

fn handle(req: *std.http.Server.Request) !void {
    const path = if (std.mem.indexOfScalar(u8, req.head.target, '?')) |i| req.head.target[0..i] else req.head.target;
    if (req.head.method == .GET and std.mem.eql(u8, path, "/healthz")) {
        return req.respond("{\\"status\\":\\"ok\\"}", .{ .extra_headers = &json });
    }
    for (routes) |r| {
        if (r.method == req.head.method and matches(r.pattern, path)) {
            var buf: [256]u8 = undefined;
            const body = try std.fmt.bufPrint(&buf, "{{\\"error\\":\\"not_implemented\\",\\"operation\\":\\"{s}\\"}}", .{r.operation});
            return req.respond(body, .{ .status = .not_implemented, .extra_headers = &json });
        }
    }
    return req.respond("{\\"error\\":\\"not_found\\"}", .{ .status = .not_found, .extra_headers = &json });
}

pub fn main() !void {
    const port = try std.fmt.parseInt(u16, std.posix.getenv("PORT") orelse "${m.port}", 10);
    const address = try std.net.Address.parseIp("0.0.0.0", port);
    var server = try address.listen(.{ .reuse_address = true });
    defer server.deinit();
    std.log.info("listening on {d}", .{port});
    while (true) {
        const conn = try server.accept();
        defer conn.stream.close();
        var buf: [16 * 1024]u8 = undefined;
        var http = std.http.Server.init(conn, &buf);
        var req = http.receiveHead() catch continue;
        handle(&req) catch |err| std.log.err("request failed: {s}", .{@errorName(err)});
    }
}
`
  f[`${m.dir}/Dockerfile`] = `FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz | tar -xJ -C /opt && ln -s /opt/zig-x86_64-linux-0.14.1/zig /usr/local/bin/zig
WORKDIR /src
COPY . .
RUN zig build -Doptimize=ReleaseSafe

FROM debian:trixie-slim
RUN useradd --system --uid 10001 app
COPY --from=build /src/zig-out/bin/app /usr/local/bin/app
USER app
EXPOSE ${m.port}
ENTRYPOINT ["/usr/local/bin/app"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'zig build run', [...(m.frameworkId ? [`${m.framework} is not generated yet; this service uses the Zig standard library HTTP server.`] : []), ...unsupportedStyle(m, 'Zig')])
  return f
}
