import express from "express";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Store } from "./store.js";
import { cookieToken, signaling } from "./signaling.js";
export function createApp(store: Store, tls?: { cert: string; key: string }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:",
    );
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== `${tls ? "https" : "http"}://${req.headers.host}`
    ) {
      res.status(403).json({ error: "Invalid origin" });
      return;
    }
    next();
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/login", (req, res) => {
    const key = req.ip ?? "local";
    let limit = attempts.get(key);
    if (!limit || limit.until < Date.now()) {
      limit = { count: 0, until: Date.now() + 60000 };
      attempts.set(key, limit);
    }
    if (++limit.count > 15) {
      res
        .status(429)
        .json({ error: "Too many login attempts. Try again in one minute." });
      return;
    }
    const { username, password } = req.body ?? {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > 256
    ) {
      res.status(400).json({ error: "Invalid credentials" });
      return;
    }
    const token = store.login(username, password);
    if (!token) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `mars=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${tls ? "; Secure" : ""}`,
    );
    res.json(store.session(token));
  });
  app.use("/api", (req, res, next) => {
    const user = store.session(cookieToken(req.headers.cookie));
    if (!user) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    res.locals.user = user;
    next();
  });
  app.get("/api/me", (_req, res) => res.json(res.locals.user));
  app.post("/api/logout", (req, res) => {
    store.logout(cookieToken(req.headers.cookie));
    signals.broadcast();
    res.setHeader(
      "Set-Cookie",
      "mars=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    res.json({ ok: true });
  });
  app.use("/api/admin", (_req, res, next) => {
    if (!res.locals.user.admin) {
      res.status(403).json({ error: "Administrator required" });
      return;
    }
    next();
  });
  app.get("/api/admin/users", (_req, res) => res.json(store.users()));
  app.get("/api/admin/groups", (_req, res) => res.json(store.groups()));
  for (const kind of ["users", "groups"] as const) {
    app.post(`/api/admin/${kind}`, (req, res) => {
      res.json(
        kind === "users"
          ? store.saveUser(undefined, req.body)
          : store.saveGroup(undefined, req.body),
      );
      signals.broadcast();
    });
    app.put(`/api/admin/${kind}/:id`, (req, res) => {
      res.json(
        kind === "users"
          ? store.saveUser(String(req.params.id), req.body)
          : store.saveGroup(String(req.params.id), req.body),
      );
      signals.broadcast();
    });
    app.delete(`/api/admin/${kind}/:id`, (req, res) => {
      if (kind === "users") store.deleteUser(String(req.params.id));
      else store.deleteGroup(String(req.params.id));
      signals.broadcast();
      res.json({ ok: true });
    });
  }
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(400)
        .json({
          error: err.message.includes("UNIQUE")
            ? "Username already exists"
            : err.message,
        }),
  );
  const server = tls
    ? httpsServer(
        { cert: readFileSync(tls.cert), key: readFileSync(tls.key) },
        app,
      )
    : httpServer(app);
  const signals = signaling(server, store);
  return { app, server, signals };
}
