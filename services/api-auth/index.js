import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import "dotenv/config";

const {
    PORT = 3004,
    MONGO_URL,
    JWT_SECRET = "dev",
} = process.env;

const app = express();
app.use(express.json());

// ===== User model =====
const User = mongoose.model(
    "User",
    new mongoose.Schema({
        email: { type: String, unique: true },
        passwordHash: String,
        role: { type: String, default: "user" },
    })
);

// ===== Register =====
app.post("/auth/register", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
        return res.status(400).json({ error: "email_and_password_required" });

        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({ email, passwordHash: hash });

        const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "1h" }
        );

        res.json({ token });
    } catch (e) {
        if (e.code === 11000) {
        return res.status(400).json({ error: "email_already_exists" });
        }
        console.error(e);
        res.status(500).json({ error: "internal_error" });
    }
});

// ===== Login =====
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "invalid_credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "1h" }
    );

    res.json({ token });
});

// ===== Me =====
app.get("/auth/me", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
        const user = jwt.verify(token, JWT_SECRET);
        res.json({ user });
    } catch {
        res.status(401).json({ error: "unauthorized" });
    }
});

// ===== Start =====
(async () => {
    await mongoose.connect(MONGO_URL);
    console.log("✅ auth connected to Mongo");
    app.listen(PORT, () =>
        console.log(`🔐 auth service running on ${PORT}`)
    );
})();
