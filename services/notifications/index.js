import express from "express";
import { WebSocketServer } from "ws";
import { Kafka } from "kafkajs";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const {
    PORT = 3003,
    GATEWAY_URL = "http://localhost:8080",

    KAFKA_CLIENT_ID = "notifications-svc",
    KAFKA_BROKERS = "",
    KAFKA_SASL_MECHANISM = "plain",
    KAFKA_SASL_USERNAME = "",
    KAFKA_SASL_PASSWORD = "",
    KAFKA_SSL = "true",
} = process.env;

// --- Express + static files ---
const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// servim web app-ul din /public
app.use(express.static(path.join(__dirname, "public")));

// endpoint REST pe care îl va apela browser-ul pentru a crea comenzi
app.post("/api/orders", async (req, res) => {
    try {
        const { amount } = req.body;
        if (typeof amount !== "number") {
        return res.status(400).json({ error: "amount_number_required" });
        }

        const authHeader = req.headers.authorization || "";
        if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "unauthorized" });
        }

        const orderResp = await fetch(`${GATEWAY_URL}/orders`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: authHeader, // forward token
        },
        body: JSON.stringify({ amount }),
        });

        const orderData = await orderResp.json();
        res.status(orderResp.status).json(orderData);
    } catch (err) {
        console.error("create-order error", err);
        res.status(500).json({ error: "internal_error" });
    }
});

    const server = app.listen(PORT, () => {
    console.log(`🔔 notifications + web on http://localhost:${PORT}`);
    });

    // --- WebSocket pentru notificări ---
    const wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", () => {
    console.log("🔔 WS client connected");
    });

/**
 * DEDUPE (Kafka + Rabbit)
 *  - cheia default: `${type}:${orderId}`
 *  - dacă nu există, fallback pe JSON string (mai rar)
 */
const seenEvents = new Set();

function eventKey(msg) {
  // cazul “bun” (cum ai în UI): { type, orderId, ... }
    if (msg && typeof msg === "object") {
        const type = msg.type ?? msg.event ?? "unknown";
        const orderId = msg.orderId ?? msg.id ?? msg.orderID ?? null;
        if (orderId) return `${type}:${orderId}`;
    }
    // fallback: dedupe pe tot payload-ul (nu ideal, dar safe)
    try {
        return `raw:${JSON.stringify(msg)}`;
    } catch {
        return `raw:${String(msg)}`;
    }
}

function broadcast(msg) {
    const key = eventKey(msg);

    // dacă deja l-am trimis recent, îl ignorăm
    if (seenEvents.has(key)) {
        return;
    }
    seenEvents.add(key);

    // curățăm după 60s ca să nu crească set-ul la infinit
    setTimeout(() => seenEvents.delete(key), 60_000);

    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
        if (client.readyState === 1) {
        client.send(data);
        }
    }
}

// --- Kafka consumer (topic: payments) ---
const kafka = new Kafka({
    clientId: KAFKA_CLIENT_ID,
    brokers: KAFKA_BROKERS.split(",").filter(Boolean),
    ssl: KAFKA_SSL === "true",
    sasl: {
        mechanism: KAFKA_SASL_MECHANISM,
        username: KAFKA_SASL_USERNAME,
        password: KAFKA_SASL_PASSWORD,
    },
});

(async () => {
    try {
        const consumer = kafka.consumer({ groupId: "notifications-group" });
        await consumer.connect();
        await consumer.subscribe({ topic: "payments", fromBeginning: false });
        console.log("🔔 notifications: consuming Kafka topic 'payments'");

        await consumer.run({
        eachMessage: async ({ message }) => {
            const txt = message.value?.toString?.() ?? "";
            let payload;
            try {
            payload = JSON.parse(txt);
            } catch {
            payload = { raw: txt };
            }

            console.log("🔔 from Kafka:", payload);
            broadcast(payload);
        },
        });
    } catch (err) {
        console.error("❌ Kafka consumer failed:", err);
    }
})();
