import http from "http";
import httpProxy from "http-proxy";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";

// ====== ENV ======
const PORT = Number(process.env.PORT || 8080);
const TARGETS = (process.env.TARGETS || "http://127.0.0.1:3001,http://127.0.0.1:3004")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

const JWT_SECRET = process.env.JWT_SECRET || "dev";
const MONGO_URL = process.env.MONGO_URL || "";

// ====== Mongo User model ======
let User;
if (MONGO_URL) {
    const userSchema = new mongoose.Schema(
        {
        email: { type: String, unique: true, required: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ["user", "admin"], default: "user" },
        },
        { timestamps: true }
    );

    User = mongoose.model("User", userSchema);
}

// ====== Helpers ======
function signToken(user) {
  // payload minimal, suficient pentru microservicii
    return jwt.sign(
        { id: String(user._id), email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "2h" }
    );
}

function auth(req, res, next) {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "unauthorized" });
    }
}

// ====== Express app (doar pentru /auth + health) ======
const app = express();

// health gateway
app.get("/health", (_req, res) => {
    res.json({ ok: true, targets: TARGETS });
});

// register (JSON parsing DOAR aici)
app.post("/auth/register", express.json(), async (req, res) => {
    try {
        if (!User) return res.status(500).json({ error: "mongo_not_configured" });

        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: "email_password_required" });

        const existing = await User.findOne({ email: String(email).toLowerCase() });
        if (existing) return res.status(409).json({ error: "email_already_used" });

        const passwordHash = await bcrypt.hash(String(password), 10);
        const user = await User.create({ email: String(email).toLowerCase(), passwordHash, role: "user" });

        const token = signToken(user);
        res.status(201).json({ token });
    } catch (err) {
        console.error("register error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});

// login
app.post("/auth/login", express.json(), async (req, res) => {
    try {
        if (!User) return res.status(500).json({ error: "mongo_not_configured" });

        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: "email_password_required" });

        const user = await User.findOne({ email: String(email).toLowerCase() });
        if (!user) return res.status(401).json({ error: "invalid_credentials" });

        const ok = await bcrypt.compare(String(password), user.passwordHash);
        if (!ok) return res.status(401).json({ error: "invalid_credentials" });

        const token = signToken(user);
        res.json({ token, role: user.role });
    } catch (err) {
        console.error("login error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});

// cine sunt eu (debug)
app.get("/auth/me", auth, (req, res) => res.json({ user: req.user }));

// ====== Proxy fallback (pentru /orders etc) ======
const proxy = httpProxy.createProxyServer({});
let rr = 0;

app.use((req, res) => {
    // marchează răspunsul ca venit prin gateway
    res.setHeader("X-Gateway", "true");

    const target = TARGETS[(rr++) % TARGETS.length];
    console.log(`→ ${req.method} ${req.url} -> ${target}`);

    proxy.web(req, res, { target }, (err) => {
        console.error("proxy error:", err);
        if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "bad_gateway" }));
    });
});

// ====== Start ======
(async () => {
    try {
        if (MONGO_URL) {
        await mongoose.connect(MONGO_URL);
        console.log("✅ Gateway connected to MongoDB");
        } else {
        console.warn("⚠️ Gateway MONGO_URL missing (auth will fail)");
        }

        const server = http.createServer(app);
        server.listen(PORT, () => {
        console.log(`✅ gateway on ${PORT} -> ${TARGETS.join(" | ")}`);
        console.log(`✅ auth endpoints: POST /auth/register, POST /auth/login, GET /auth/me`);
        });
    } catch (e) {
        console.error("❌ gateway startup error:", e);
        process.exit(1);
    }
})();
