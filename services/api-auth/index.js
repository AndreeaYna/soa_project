import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";

const {
    PORT = 3010,
    MONGO_URL,
    JWT_SECRET = "dev",
    ADMIN_EMAIL = "",
    ADMIN_PASSWORD = "",
} = process.env;

if (!MONGO_URL) {
    console.error("❌ api-auth: MONGO_URL missing");
    process.exit(1);
}

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const User = mongoose.model(
    "User",
    new mongoose.Schema(
        {
        email: { type: String, unique: true, required: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ["user", "admin"], default: "user" },
        },
        { timestamps: true }
    )
);

function signToken(user) {
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

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
}

app.get("/health", (_req, res) => res.json({ ok: true, svc: "api-auth" }));

app.post("/auth/register", async (req, res) => {
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        const password = String(req.body?.password || "");

        if (!email || !password) return res.status(400).json({ error: "email_password_required" });

        const exists = await User.findOne({ email });
        if (exists) return res.status(409).json({ error: "email_already_exists" });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, passwordHash, role: "user" });

        res.status(201).json({ token: signToken(user), role: user.role });
    } catch (e) {
        console.error("register error:", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.post("/auth/login", async (req, res) => {
    try {
        const email = String(req.body?.email || "").toLowerCase().trim();
        const password = String(req.body?.password || "");

        if (!email || !password) return res.status(400).json({ error: "email_password_required" });

        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ error: "invalid_credentials" });

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: "invalid_credentials" });

        res.json({ token: signToken(user), role: user.role });
    } catch (e) {
        console.error("login error:", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.get("/auth/me", auth, (req, res) => res.json({ user: req.user }));

/* ===================== ADMIN API ===================== */

app.get("/auth/admin/users", auth, requireAdmin, async (req, res) => {
    try {
        const emailQ = String(req.query?.email || "").toLowerCase().trim();
        const q = emailQ ? { email: { $regex: emailQ, $options: "i" } } : {};
        const users = await User.find(q).sort({ createdAt: -1 }).limit(500);

        res.json(
        users.map((u) => ({
            id: String(u._id),
            email: u.email,
            role: u.role,
            createdAt: u.createdAt?.toISOString?.() || String(u.createdAt),
        }))
        );
    } catch (e) {
        console.error("admin users list error:", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.patch("/auth/admin/users/:id/role", auth, requireAdmin, async (req, res) => {
    try {
        const id = String(req.params.id || "");
        const role = String(req.body?.role || "").toLowerCase().trim();

        if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "invalid_role" });

        const u = await User.findById(id);
        if (!u) return res.status(404).json({ error: "not_found" });

        if (String(u._id) === String(req.user?.id) && role !== "admin") {
        return res.status(400).json({ error: "cannot_downgrade_self" });
        }

        u.role = role;
        await u.save();

        res.json({ ok: true, id: String(u._id), role: u.role });
    } catch (e) {
        console.error("admin user role error:", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.delete("/auth/admin/users/:id", auth, requireAdmin, async (req, res) => {
    try {
        const id = String(req.params.id || "");

        if (id === String(req.user?.id)) {
        return res.status(400).json({ error: "cannot_delete_self" });
        }

        const del = await User.findByIdAndDelete(id);
        if (!del) return res.status(404).json({ error: "not_found" });

        res.json({ ok: true });
    } catch (e) {
        console.error("admin user delete error:", e);
        res.status(500).json({ error: "internal_error" });
    }
});

/* ===================== seed admin ===================== */

async function seedAdmin() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.log("ℹ️ admin seed skipped (ADMIN_EMAIL/ADMIN_PASSWORD not set)");
        return;
    }

    const email = ADMIN_EMAIL.toLowerCase().trim();
    const existing = await User.findOne({ email });

    if (existing) {
        if (existing.role !== "admin") {
        existing.role = "admin";
        await existing.save();
        console.log(`✅ upgraded to admin: ${email}`);
        } else {
        console.log(`✅ admin exists: ${email}`);
        }
        return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.create({ email, passwordHash, role: "admin" });
    console.log(`✅ seeded admin: ${email}`);
}

(async () => {
    await mongoose.connect(MONGO_URL);
    console.log("✅ auth connected to Mongo");

    await seedAdmin();

    app.listen(PORT, () => console.log(`🔐 auth service running on ${PORT}`));
})();
