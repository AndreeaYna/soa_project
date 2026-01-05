import http from "http";
import express from "express";
import httpProxy from "http-proxy";
import jwt from "jsonwebtoken";
import "dotenv/config";

// ===== ENV =====
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "dev";

// ROUTES example:
// ROUTES=/auth=http://127.0.0.1:3010,/orders=http://127.0.0.1:3001|http://127.0.0.1:3011,/payments=http://127.0.0.1:3002,/notifications=http://127.0.0.1:3003
const ROUTES = (process.env.ROUTES ||
    "/auth=http://127.0.0.1:3010,/orders=http://127.0.0.1:3001"
    )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
        const [prefix, targetStr] = pair.split("=").map((x) => x.trim());
        const targets = (targetStr || "")
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean);
        return { prefix, targets, rr: 0 };
    })
    .sort((a, b) => b.prefix.length - a.prefix.length);

const DEFAULT_TARGET = process.env.DEFAULT_TARGET || "";

// ===== Helpers =====
function pickTarget(url) {
    const hit = ROUTES.find(
        (r) =>
        url === r.prefix ||
        url.startsWith(r.prefix + "/") ||
        url.startsWith(r.prefix + "?")
    );

    if (!hit || hit.targets.length === 0) return DEFAULT_TARGET || null;

    const target = hit.targets[hit.rr % hit.targets.length];
    hit.rr++;
    return target;
}

function verifyJwt(req) {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    return jwt.verify(token, JWT_SECRET);
}

function authRequired(req, res, next) {
    try {
        req.user = verifyJwt(req);
        next();
    } catch {
        res.status(401).json({ error: "unauthorized" });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
}

// ===== App =====
const app = express();

// CORS (dev)
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// health
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        routes: ROUTES.map((r) => ({ prefix: r.prefix, targets: r.targets })),
        defaultTarget: DEFAULT_TARGET || null,
    });
});

// ===== Proxy =====
const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
});

proxy.on("error", (err, _req, res) => {
    console.error("proxy error:", err?.message || err);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway" }));
});

// mark response
app.use((req, res, next) => {
    res.setHeader("X-Gateway", "true");
    next();
});

// Auth policy:
// public: /health, /auth/**
// protected: everything else
app.use((req, res, next) => {
    if (req.url === "/health") return next();
    if (req.url.startsWith("/auth")) return next();
    return authRequired(req, res, next);
});

// Admin policy (doar pentru /admin/*)
app.use((req, res, next) => {
    if (req.url.startsWith("/admin")) return requireAdmin(req, res, next);
    next();
});

// proxy final
app.use((req, res) => {
    const target = pickTarget(req.url);
    if (!target) return res.status(502).json({ error: "no_route", url: req.url });

    console.log(`→ ${req.method} ${req.url} -> ${target}`);
    proxy.web(req, res, { target });
});

http.createServer(app).listen(PORT, () => {
    console.log(`✅ gateway on ${PORT}`);
    console.log(`✅ routes: ${ROUTES.map((r) => `${r.prefix}=>${r.targets.join("|")}`).join(" | ")}`);
});
