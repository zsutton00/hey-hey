import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const serviceName = "hey-hey-ui";
const distDir = process.env.DIST_DIR || path.join(process.cwd(), "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "5173", 10);
const logLevel = process.env.LOG_LEVEL || "info";

const logLevels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const levelValue = logLevels[logLevel] ?? logLevels.info;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function log(level, event, data = {}) {
  const nextLevel = logLevels[level] ?? logLevels.info;
  if (nextLevel < levelValue) {
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      service: serviceName,
      ...data,
    })}\n`,
  );
}

function readRuntimeValue(name, defaultValue = "") {
  const valueFromEnv = process.env[name];
  const fileVar = `${name}_FILE`;
  const valueFilePath = process.env[fileVar];

  if (valueFromEnv && valueFilePath) {
    log("warn", "runtime_value_conflict", {
      variable: name,
      fileVariable: fileVar,
      resolution: "environment_variable_precedence",
    });
    return valueFromEnv;
  }

  if (valueFilePath) {
    try {
      return readFileSync(valueFilePath, "utf8").trim();
    } catch (error) {
      log("error", "runtime_file_read_failed", {
        variable: name,
        fileVariable: fileVar,
        filePath: valueFilePath,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  }

  if (valueFromEnv !== undefined) {
    return valueFromEnv;
  }

  return defaultValue;
}

function normalizeBasePath(value) {
  if (!value) {
    return "/api/v1";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function stripApiVersionSuffix(basePath) {
  return (basePath || "").replace(/\/api(?:\/v\d+)?\/?$/, "");
}

function buildHttpUrl(protocol, apiHost, apiPort, basePath) {
  const protocolValue = protocol || "http";
  const hostValue = apiHost || "localhost";
  const portSegment = apiPort ? `:${apiPort}` : "";
  const normalizedBasePath = basePath
    ? basePath.startsWith("/")
      ? basePath
      : `/${basePath}`
    : "";
  return `${protocolValue}://${hostValue}${portSegment}${normalizedBasePath}`;
}

function buildWsUrl(protocol, apiHost, apiPort, basePath) {
  const normalizedProtocol = protocol === "https" ? "wss" : "ws";
  const websocketBasePath = stripApiVersionSuffix(basePath);
  return buildHttpUrl(normalizedProtocol, apiHost, apiPort, websocketBasePath);
}

async function writeRuntimeConfig() {
  const apiProtocol = readRuntimeValue("API_PROTOCOL", "http");
  const apiHost = readRuntimeValue("API_HOST", "localhost");
  const apiPort = readRuntimeValue("API_PORT", "3000");
  const apiBasePath = normalizeBasePath(
    readRuntimeValue("API_BASE_PATH", "/api/v1"),
  );
  const explicitApiUrl = readRuntimeValue("VITE_API_URL", "");
  const explicitWsUrl = readRuntimeValue("VITE_WS_URL", "");
  const runtimeEnv = readRuntimeValue(
    "VITE_ENV",
    process.env.NODE_ENV || "production",
  );

  const apiUrl =
    explicitApiUrl || buildHttpUrl(apiProtocol, apiHost, apiPort, apiBasePath);
  const wsUrl =
    explicitWsUrl || buildWsUrl(apiProtocol, apiHost, apiPort, apiBasePath);

  const runtimeConfig = {
    apiProtocol,
    apiHost,
    apiPort,
    apiBasePath,
    apiUrl,
    wsUrl,
    env: runtimeEnv,
    goatCounterEndpoint: readRuntimeValue("VITE_GOATCOUNTER_ENDPOINT", ""),
    localAgentPort: readRuntimeValue("VITE_LOCAL_AGENT_PORT", ""),
    botCheckSiteKey: readRuntimeValue("VITE_BOT_CHECK_SITE_KEY", ""),
  };

  const runtimeConfigPath = path.join(distDir, "runtime-config.js");
  const runtimeConfigContent = `window.__HEY_HEY_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(
    runtimeConfig,
    null,
    2,
  )});\n`;

  await mkdir(distDir, { recursive: true });
  await writeFile(runtimeConfigPath, runtimeConfigContent, "utf8");

  log("info", "runtime_config_ready", {
    runtimeConfigPath,
    apiUrl,
    wsUrl,
    apiProtocol,
    apiHost,
    apiPort,
    apiBasePath,
  });
}

function getFilePathFromRequestPath(requestPath) {
  const normalizedPath = path.posix.normalize(requestPath);
  if (normalizedPath.includes("..")) {
    return null;
  }

  const requestedPath =
    normalizedPath === "/"
      ? "/index.html"
      : normalizedPath.endsWith("/")
        ? `${normalizedPath}index.html`
        : normalizedPath;

  return path.join(distDir, requestedPath);
}

async function resolvePathToServe(requestPath) {
  const directPath = getFilePathFromRequestPath(requestPath);
  if (!directPath) {
    return null;
  }

  try {
    const directStat = await stat(directPath);
    if (directStat.isFile()) {
      return directPath;
    }
  } catch (_error) {
    // Fall back to index.html for SPA routes.
  }

  if (requestPath.startsWith("/config/")) {
    return null;
  }

  const indexPath = path.join(distDir, "index.html");
  return existsSync(indexPath) ? indexPath : null;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return contentTypes[extension] || "application/octet-stream";
}

function getAcceptedEncodings(req) {
  const acceptEncoding = req.headers["accept-encoding"] || "";
  return new Set(
    acceptEncoding.split(",").map((s) => s.trim().toLowerCase().split(";")[0]),
  );
}

function findCompressedVariant(filePath, encodings) {
  if (encodings.has("br")) {
    const brPath = `${filePath}.br`;
    if (existsSync(brPath)) {
      return { path: brPath, encoding: "br" };
    }
  }
  if (encodings.has("gzip")) {
    const gzPath = `${filePath}.gz`;
    if (existsSync(gzPath)) {
      return { path: gzPath, encoding: "gzip" };
    }
  }
  return null;
}

await writeRuntimeConfig();

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const method = req.method || "GET";
  const hostHeader = req.headers.host || "localhost";
  let requestPath = "/";

  res.once("finish", () => {
    log("info", "http_request", {
      method,
      path: requestPath,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userAgent: req.headers["user-agent"] || "",
    });
  });

  try {
    const url = new URL(req.url || "/", `http://${hostHeader}`);
    requestPath = url.pathname;

    if (requestPath === "/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", service: serviceName }));
      return;
    }

    const filePath = await resolvePathToServe(requestPath);
    if (!filePath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    const encodings = getAcceptedEncodings(req);
    const compressed = findCompressedVariant(filePath, encodings);
    const finalFilePath = compressed?.path ?? filePath;

    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(filePath));

    if (compressed) {
      res.setHeader("Content-Encoding", compressed.encoding);
      res.setHeader("Vary", "Accept-Encoding");
    }

    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    } else if (
      filePath.endsWith("runtime-config.js") ||
      requestPath.startsWith("/config/")
    ) {
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }

    const stream = createReadStream(finalFilePath);
    stream.on("error", (error) => {
      log("error", "file_stream_error", {
        path: requestPath,
        filePath,
        message: error.message,
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    });
    stream.pipe(res);
  } catch (error) {
    log("error", "request_handling_error", {
      path: requestPath,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  }
});

server.listen(port, host, () => {
  const address = server.address();
  log("info", "server_started", {
    host,
    port: typeof address === "object" && address ? address.port : port,
    distDir,
    logLevel,
  });
});
