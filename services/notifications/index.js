import express from "express";
import { WebSocketServer } from "ws";
import { Kafka } from "kafkajs";
import jwt from "jsonwebtoken";
import "dotenv/config";

const {
    PORT = 3003,
    GATEWAY_URL = "http://localhost:8080",
    JWT_SECRET = "dev",

    KAFKA_CLIENT_ID = "notifications-svc",
    KAFKA_BROKERS = "",
    KAFKA_SASL_MECHANISM = "scram-sha-256",
    KAFKA_SASL_USERNAME = "",
    KAFKA_SASL_PASSWORD = "",
    KAFKA_SSL = "true",
    NOTIFICATIONS_GROUP_ID = "notifications-group",
} = process.env;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, svc: "notifications" }));

/* ===================== auth helpers ===================== */
function auth(req, res, next) {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        console.log("JWT verify failed:", e?.message);
        res.status(401).json({ error: "unauthorized" });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
}

/* ===================== create order (browser -> notifications -> gateway) ===================== */
app.post("/api/orders", async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        const planId = req.body?.planId || null;
        const planName = req.body?.planName || null;

        if (!amount || amount <= 0) return res.status(400).json({ error: "amount_number_required" });

        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "unauthorized" });

        const orderResp = await fetch(`${GATEWAY_URL}/orders`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: authHeader,
        },
        body: JSON.stringify({ amount, planId, planName }),
        });

        const orderData = await orderResp.json().catch(() => ({}));
        res.status(orderResp.status).json(orderData);
    } catch (err) {
        console.error("create-order error", err);
        res.status(500).json({ error: "internal_error" });
    }
});

/* ===================== admin: recent payments + recent orders + audit ===================== */

const paymentsBuffer = [];
const MAX_PAYMENTS = 200;

function pushPaymentEvent(ev) {
    paymentsBuffer.unshift(ev);
    if (paymentsBuffer.length > MAX_PAYMENTS) paymentsBuffer.length = MAX_PAYMENTS;
}

async function safeJsonOrText(resp) {
    const ct = String(resp.headers.get("content-type") || "");
    if (ct.includes("application/json")) {
        return await resp.json().catch(() => null);
    }
    const txt = await resp.text().catch(() => "");
    return { _nonJson: true, text: txt };
}

app.get("/api/admin/payments/recent", auth, requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
    res.json(paymentsBuffer.slice(0, limit));
});

app.get("/api/admin/orders/recent", auth, requireAdmin, async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
        const authHeader = req.headers.authorization || "";

        const r = await fetch(`${GATEWAY_URL}/orders`, {
        headers: { authorization: authHeader },
        });

        const payload = await safeJsonOrText(r);

        if (payload && payload._nonJson) {
        return res.status(r.status).json({
            error: "upstream_non_json",
            status: r.status,
            hint: "Gateway/Orders returned non-JSON. Check route & ports.",
            sample: String(payload.text || "").slice(0, 300),
        });
        }

        const items = Array.isArray(payload) ? payload : (payload?.orders || payload?.items || []);
        res.status(r.status).json(items.slice(0, limit));
    } catch (e) {
        console.error("admin recent orders error", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.delete("/api/admin/orders/:id", auth, requireAdmin, async (req, res) => {
    try {
        const id = String(req.params.id || "");
        const authHeader = req.headers.authorization || "";

        const r = await fetch(`${GATEWAY_URL}/admin/orders/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { authorization: authHeader },
        });

        const payload = await safeJsonOrText(r);
        res.status(r.status).json(payload && payload._nonJson ? { error: "upstream_non_json" } : payload);
    } catch (e) {
        console.error("admin delete order error", e);
        res.status(500).json({ error: "internal_error" });
    }
});

app.get("/api/admin/audit", auth, requireAdmin, async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 25)));
        const authHeader = req.headers.authorization || "";

        const r = await fetch(`${GATEWAY_URL}/orders`, {
        headers: { authorization: authHeader },
        });

        const ordersPayload = await safeJsonOrText(r);
        const orders = (ordersPayload && ordersPayload._nonJson)
        ? { error: "upstream_non_json", status: r.status }
        : (Array.isArray(ordersPayload) ? ordersPayload.slice(0, limit) : ordersPayload);

        res.json({
        ts: Date.now(),
        payments: paymentsBuffer.slice(0, limit),
        orders,
        });
    } catch (e) {
        console.error("admin audit error", e);
        res.status(500).json({ error: "internal_error" });
    }
});

/* ===================== WS + Kafka ===================== */

const server = app.listen(PORT, () => {
    console.log(`🔔 notifications on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", () => console.log("🔔 WS client connected"));

function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
        if (client.readyState === 1) client.send(data);
    }
}

async function startKafkaConsumer() {
    if (!KAFKA_BROKERS) {
        console.log("⚠️ notifications: KAFKA_BROKERS missing (no live events)");
        return;
    }

    const kafka = new Kafka({
        clientId: KAFKA_CLIENT_ID,
        brokers: KAFKA_BROKERS.split(",").map((s) => s.trim()).filter(Boolean),
        ssl: KAFKA_SSL === "true",
        sasl: {
        mechanism: KAFKA_SASL_MECHANISM,
        username: KAFKA_SASL_USERNAME,
        password: KAFKA_SASL_PASSWORD,
        },
    });

    const consumer = kafka.consumer({ groupId: NOTIFICATIONS_GROUP_ID });
    await consumer.connect();
    await consumer.subscribe({ topic: "payments", fromBeginning: false });

    console.log(`🔔 consuming Kafka 'payments' as group '${NOTIFICATIONS_GROUP_ID}'`);

    await consumer.run({
        eachMessage: async ({ message }) => {
        const txt = message.value?.toString?.() ?? "";
        let payload;
        try {
            payload = JSON.parse(txt);
        } catch {
            payload = { raw: txt };
        }

        pushPaymentEvent(payload);
        broadcast(payload);
        },
    });
}

startKafkaConsumer().catch((err) => {
    console.error("❌ notifications Kafka consumer failed:", err?.message || err);
});
