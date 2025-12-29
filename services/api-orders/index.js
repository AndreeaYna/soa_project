import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import amqp from "amqplib";
import { Kafka } from "kafkajs";
import fetch from "node-fetch";
import "dotenv/config";

// === Config ===
const {
    PORT = 3001,
    INSTANCE_ID = "orders-1",
    JWT_SECRET = "dev",
    MONGO_URL,
    RABBIT_URL,
    FRAUD_URL = "",
    KAFKA_BROKERS = "",
    KAFKA_SASL_MECHANISM = "scram-sha-256",
    KAFKA_SASL_USERNAME = "",
    KAFKA_SASL_PASSWORD = "",
    KAFKA_SSL = "true",
} = process.env;

// === App setup ===
const app = express();
app.use(express.json());

// Add instance header for debugging / gateway round-robin
app.use((_, res, next) => {
    res.set("X-Instance-Id", INSTANCE_ID);
    next();
});

// === Auth middleware ===
function auth(req, res, next) {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    try {
        req.user = jwt.verify(token, JWT_SECRET); // { id, email, role }
        next();
    } catch {
        res.status(401).json({ error: "unauthorized" });
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") return res.status(403).json({ error: "forbidden" });
    next();
}

// === Mongo Model ===
const Order = mongoose.model(
    "Order",
    new mongoose.Schema(
        {
        userId: String,
        amount: Number,
        status: { type: String, default: "created" },
        },
        { timestamps: true }
    )
);

// === Globals for connections ===
let rabbitCh;
let producer;

// === Routes ===
app.get("/health", (_, res) => res.json({ ok: true, instance: INSTANCE_ID }));

// LIST orders (user vede doar ale lui, admin vede toate)
app.get("/orders", auth, async (req, res) => {
    try {
        const filter = req.user.role === "admin" ? {} : { userId: req.user.id };
        const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(50);
        res.json(orders);
    } catch (err) {
        console.error("❌ list orders error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});

// CREATE order
app.post("/orders", auth, async (req, res) => {
    try {
        const { amount } = req.body;

        // Check fraud (optional)
        const fraud = FRAUD_URL
        ? await (
            await fetch(FRAUD_URL, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ amount }),
            })
            )
            .json()
            .catch(() => ({ score: 0 }))
        : { score: 0 };

        if (fraud.score > 0.8) {
        return res.status(400).json({ error: "fraud suspected" });
        }

        // Create order in MongoDB
        const order = await Order.create({ userId: req.user.id, amount });

        // Send to RabbitMQ (for payments queue)
        await rabbitCh.assertQueue("charge");
        await rabbitCh.sendToQueue("charge", Buffer.from(JSON.stringify({ orderId: order._id, amount })));

        // Produce Kafka event
        await producer.send({
        topic: "orders",
        messages: [
            {
            key: String(order._id),
            value: JSON.stringify({
                event: "created",
                id: String(order._id),
                amount,
            }),
            },
        ],
        });

        res.status(201).json(order);
    } catch (err) {
        console.error("❌ Order error:", err);
        res.status(500).json({ error: "internal_error" });
    }
    });

    // (Optional) Admin delete order
    app.delete("/admin/orders/:id", auth, requireAdmin, async (req, res) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "not_found" });
        res.json({ ok: true });
    } catch (err) {
        console.error("❌ admin delete error:", err);
        res.status(500).json({ error: "internal_error" });
    }
    });

    // === Startup ===
    (async () => {
    try {
        // Connect to Mongo
        if (MONGO_URL) {
        await mongoose.connect(MONGO_URL);
        console.log("✅ Connected to MongoDB");
        }

        // Connect to RabbitMQ
        if (RABBIT_URL) {
        const conn = await amqp.connect(RABBIT_URL);
        rabbitCh = await conn.createChannel();
        console.log("✅ Connected to RabbitMQ");
        }

        // Connect to Kafka
        const kafka = new Kafka({
        brokers: KAFKA_BROKERS.split(",").filter(Boolean),
        ssl: KAFKA_SSL === "true",
        sasl: {
            mechanism: KAFKA_SASL_MECHANISM,
            username: KAFKA_SASL_USERNAME,
            password: KAFKA_SASL_PASSWORD,
        },
        });

        producer = kafka.producer();
        await producer.connect();
        console.log("✅ Connected to Kafka (Redpanda)");

        // Start server
        app.listen(PORT, () => console.log(`🚀 Orders service running on port ${PORT} (${INSTANCE_ID})`));
    } catch (err) {
        console.error("❌ Startup error:", err);
        process.exit(1);
    }
    })();

    // === Graceful shutdown ===
    function graceful() {
    console.log("🔻 Shutting down...");
    Promise.allSettled([producer?.disconnect(), rabbitCh?.close(), mongoose.connection?.close()]).finally(() =>
        process.exit(0)
    );
}

process.on("SIGINT", graceful);
process.on("SIGTERM", graceful);
