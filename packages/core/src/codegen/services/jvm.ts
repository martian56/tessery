import { type Files, type ServiceModel, camel, comment, envExample, ident, pascal, readme, stepLines } from './model'

const pkgName = (m: ServiceModel) => `com.example.${ident(m.name).toLowerCase()}`

function javaDeps(m: ServiceModel): string {
  return m.deps.map((d) => `            Map.entry("${d.env}", env("${d.env}", "${d.url}"))`).join(',\n')
}

export function javaService(m: ServiceModel): Files {
  const pkg = pkgName(m)
  const dir = `${m.dir}/src/main/java/${pkg.replace(/\./g, '/')}`
  const gql = m.kind === 'api' && m.style === 'graphql'
  const notes: string[] = []
  if (['quarkus', 'micronaut'].includes(m.frameworkId)) notes.push(`${m.framework} is not generated yet; this service uses Spring Boot.`)
  if (m.kind === 'api' && ['grpc', 'websocket', 'soap'].includes(m.style)) notes.push(`${m.style} handlers are not generated for Java yet; the contract is included and HTTP health is served by Spring Boot.`)
  const f: Files = {}
  f[`${dir}/Application.java`] = `package ${pkg};

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class Application {
    /** Connection URLs for the services this one depends on. */
    public static final Map<String, String> DEPENDENCIES = Map.ofEntries(
${javaDeps(m)}
    );

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @GetMapping("/healthz")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    private static String env(String key, String fallback) {
        String v = System.getenv(key);
        return v == null || v.isEmpty() ? fallback : v;
    }
}
`
  if (m.kind === 'api' && m.routes.length) {
    f[`${dir}/ApiController.java`] = `package ${pkg};

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class ApiController {
    private static ResponseEntity<Map<String, String>> notImplemented(String operation) {
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED).body(Map.of("error", "not_implemented", "operation", operation));
    }
${m.routes.map((r) => `
${comment(stepLines(r.op), '//', '    ')}
    @${pascal(r.method.toLowerCase())}Mapping("${r.path}")
    public ResponseEntity<Map<String, String>> ${camel(r.name)}() {
        return notImplemented("${r.name}");
    }`).join('\n')}
}
`
  }
  if (gql) {
    const kinds: [string, string][] = [['query', 'QueryMapping'], ['mutation', 'MutationMapping']]
    f[`${dir}/GraphqlController.java`] = `package ${pkg};

import org.springframework.graphql.data.method.annotation.*;
import org.springframework.stereotype.Controller;

@Controller
public class GraphqlController {
${kinds.flatMap(([k, ann]) => m.operations.filter((o) => o.kind.toLowerCase() === k).map((o) => `
${comment(stepLines(o), '//', '    ')}
    @${ann}
    public Object ${o.name}() {
        throw new UnsupportedOperationException("${o.name} is not implemented yet");
    }`)).join('\n')}
}
`
  }
  if (m.kind !== 'api') {
    f[`${dir}/Job.java`] = `package ${pkg};

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

${m.kind === 'cron' ? `/** Runs once per schedule (${m.schedule}); the platform starts the container on that schedule. */` : `/** Consumes work from: ${m.sources.join(', ') || 'nothing connected yet'}. Replace the loop body with the client for that source. */`}
@Component
public class Job implements CommandLineRunner {
    @Override
    public void run(String... args) throws Exception {
        System.out.println("${m.name} started with " + Application.DEPENDENCIES.size() + " dependencies");
${m.kind === 'cron' ? '        System.exit(0);' : '        while (true) {\n            Thread.sleep(1000);\n        }'}
    }
}
`
  }
  f[`${m.dir}/src/main/resources/application.properties`] = `spring.application.name=${m.name}\nserver.port=\${PORT:${m.port}}\n`
  f[`${m.dir}/pom.xml`] = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.5.3</version>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>${ident(m.name).toLowerCase()}</artifactId>
  <version>0.1.0</version>
  <properties>
    <java.version>21</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>${gql ? `
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-graphql</artifactId>
    </dependency>` : ''}
  </dependencies>
  <build>
    <finalName>app</finalName>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`
  if (gql) f[`${m.dir}/src/main/resources/graphql/schema.graphqls`] = ''
  f[`${m.dir}/Dockerfile`] = `FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
COPY --from=build /src/target/app.jar /app.jar
USER app
EXPOSE ${m.port}
ENTRYPOINT ["java", "-jar", "/app.jar"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'mvn spring-boot:run', notes)
  return f
}

export function kotlinService(m: ServiceModel): Files {
  const pkg = pkgName(m)
  const notes: string[] = []
  if (m.frameworkId === 'spring-kt') notes.push('Spring Boot for Kotlin is not generated yet; this service uses Ktor.')
  if (m.kind === 'api' && !['rest', 'webhook', 'sse'].includes(m.style)) notes.push(`${m.style} handlers are not generated for Kotlin yet; the contract is included and Ktor serves health.`)
  const f: Files = {}
  f[`${m.dir}/src/main/kotlin/${pkg.replace(/\./g, '/')}/Application.kt`] = `package ${pkg}

import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.response.respondText
import io.ktor.server.routing.*

private fun env(key: String, fallback: String) = System.getenv(key)?.takeIf { it.isNotEmpty() } ?: fallback

/** Connection URLs for the services this one depends on. */
val dependencies = mapOf(
${m.deps.map((d) => `    "${d.env}" to env("${d.env}", "${d.url}"),`).join('\n')}
)

fun main() {
${m.kind === 'cron' ? `    // Runs once per schedule (${m.schedule}); the platform starts the container on that schedule.
    println("${m.name} started with \${dependencies.size} dependencies")
    return
` : ''}    embeddedServer(Netty, port = env("PORT", "${m.port}").toInt(), host = "0.0.0.0") {
        routing {
            get("/healthz") { call.respondText("""{"status":"ok"}""", ContentType.Application.Json) }
${m.kind === 'api' ? m.routes.map((r) => `${comment(stepLines(r.op), '//', '            ')}
            ${r.method.toLowerCase()}("${r.path}") {
                call.respondText("""{"error":"not_implemented","operation":"${r.name}"}""", ContentType.Application.Json, HttpStatusCode.NotImplemented)
            }`).join('\n') : `            // Worker: consumes from ${m.sources.join(', ') || 'nothing connected yet'}.`}
        }
    }.start(wait = true)
}
`
  f[`${m.dir}/build.gradle.kts`] = `plugins {
    kotlin("jvm") version "2.2.0"
    id("io.ktor.plugin") version "3.2.0"
}

group = "com.example"
version = "0.1.0"

application {
    mainClass.set("${pkg}.ApplicationKt")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core-jvm")
    implementation("io.ktor:ktor-server-netty-jvm")
    implementation("ch.qos.logback:logback-classic:1.5.18")
}

kotlin {
    jvmToolchain(21)
}
`
  f[`${m.dir}/settings.gradle.kts`] = `rootProject.name = "${ident(m.name).toLowerCase()}"\n`
  f[`${m.dir}/Dockerfile`] = `FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY . .
RUN gradle buildFatJar --no-daemon -q

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
COPY --from=build /src/build/libs/*-all.jar /app.jar
USER app
EXPOSE ${m.port}
ENTRYPOINT ["java", "-jar", "/app.jar"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'gradle run', notes)
  return f
}

export function scalaService(m: ServiceModel): Files {
  const notes: string[] = []
  if (m.frameworkId === 'caliban') notes.push('Caliban is not generated yet; the schema is included and http4s serves HTTP and health.')
  const f: Files = {}
  const route = (p: string) => p.split('/').filter(Boolean).map((seg) => (/^\{\w+\}$/.test(seg) ? `${seg.slice(1, -1)}` : `"${seg}"`)).join(' / ')
  f[`${m.dir}/Main.scala`] = `//> using scala 3.3.6
//> using dep org.http4s::http4s-ember-server:0.23.30
//> using dep org.http4s::http4s-dsl:0.23.30

import cats.effect.*
import com.comcast.ip4s.*
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder

object Main extends IOApp.Simple:
  private def env(key: String, fallback: String) = sys.env.get(key).filter(_.nonEmpty).getOrElse(fallback)

  /** Connection URLs for the services this one depends on. */
  val dependencies: Map[String, String] = Map(
${m.deps.map((d) => `    "${d.env}" -> env("${d.env}", "${d.url}"),`).join('\n')}
  )

  private def notImplemented(op: String) =
    IO.pure(Response[IO](Status.NotImplemented).withEntity(s"""{"error":"not_implemented","operation":"$op"}"""))

  val routes = HttpRoutes.of[IO] {
    case GET -> Root / "healthz" => Ok("""{"status":"ok"}""")
${m.kind === 'api' ? m.routes.map((r) => {
    const segs = route(r.path)
    const pattern = segs ? `Root / ${segs}` : 'Root'
    return `${comment(stepLines(r.op), '//', '    ')}
    case ${r.method} -> ${pattern} => notImplemented("${r.name}")`
  }).join('\n') : ''}
  }

  def run: IO[Unit] =
    EmberServerBuilder.default[IO]
      .withHost(ipv4"0.0.0.0")
      .withPort(Port.fromInt(env("PORT", "${m.port}").toInt).get)
      .withHttpApp(routes.orNotFound)
      .build
      .useForever
`
  f[`${m.dir}/Dockerfile`] = `FROM virtuslab/scala-cli:latest AS build
WORKDIR /src
COPY Main.scala .
RUN scala-cli --power package Main.scala --assembly -o /app.jar --server=false

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 app
COPY --from=build /app.jar /app.jar
USER app
EXPOSE ${m.port}
ENTRYPOINT ["java", "-jar", "/app.jar"]
`
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'scala-cli run Main.scala', notes)
  return f
}
