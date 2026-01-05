import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import amqp from "amqplib";
import { Kafka } from "kafkajs";
import fetch from "node-fetch";
import "dotenv/config";

const {
    PORT = 3001,
    INSTANCE_ID = "orders-1",
    JWT_SECRET = "dev",
    MONGO_URL,
    RABBIT_URL,

    // optional fraud service (FaaS)
    FRAUD_URL = "",

    // Kafka (Redpanda)
    KAFKA_BROKERS = "",
    KAFKA_SASL_MECHANISM = "scram-sha-256",
    KAFKA_SASL_USERNAME = "",
    KAFKA_SASL_PASSWORD = "",
    KAFKA_SSL = "true",
} = process.env;

const app = express();
app.use(express.json());

app.use((_, res, next) => {
    res.set("X-Instance-Id", INSTANCE_ID);
    next();
});

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

const Order = mongoose.model(
    "Order",
    new mongoose.Schema(
        {
        userId: String,
        userEmail: String,
        planId: String,
        planName: String,
        amount: Number,
        status: { type: String, default: "created" },
        },
        { timestamps: true }
    )
);

let rabbitConn, rabbitCh;
let producer;

app.get("/health", (_, res) => res.json({ ok: true, instance: INSTANCE_ID }));

app.get("/orders", auth, async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
        const filter = req.user.role === "admin" ? {} : { userId: req.user.id };

        const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit);
        res.json(orders);
    } catch (err) {
        console.error("list orders error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});


app.post("/orders", auth, async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        if (!amount || amount <= 0) return res.status(400).json({ error: "amount_must_be_positive" });

        const planId = req.body?.planId ? String(req.body.planId) : "";
        const planName = req.body?.planName ? String(req.body.planName) : "";
        const userEmail = req.user?.email ? String(req.user.email) : "";

        // optional fraud check
        if (FRAUD_URL) {
        const fraud = await fetch(FRAUD_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amount }),
        })
            .then((r) => r.json())
            .catch(() => ({ score: 0 }));

        if (fraud.score > 0.8) return res.status(400).json({ error: "fraud_suspected" });
        }

        const order = await Order.create({
        userId: req.user.id,
        userEmail,
        planId,
        planName,
        amount,
        status: "created",
        });

        // Rabbit -> payments queue
        if (rabbitCh) {
        await rabbitCh.assertQueue("charge", { durable: true });
        rabbitCh.sendToQueue(
            "charge",
            Buffer.from(
            JSON.stringify({
                orderId: String(order._id),
                amount,
                userId: req.user.id,
                userEmail,
                planId,
                planName,
                ts: Date.now(),
            })
            ),
            { persistent: true }
        );
        }

        // Kafka -> orders topic
        if (producer) {
        await producer.send({
            topic: "orders",
            messages: [
            {
                key: String(order._id),
                value: JSON.stringify({
                event: "order.created",
                id: String(order._id),
                amount,
                userId: req.user.id,
                userEmail,
                planId,
                planName,
                ts: Date.now(),
                source: INSTANCE_ID,
                }),
            },
            ],
        });
        }

        res.status(201).json(order);
    } catch (err) {
        console.error("create order error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});

app.delete("/admin/orders/:id", auth, requireAdmin, async (req, res) => {
    try {
        const deleted = await Order.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "not_found" });
        res.json({ ok: true });
    } catch (err) {
        console.error("admin delete error:", err);
        res.status(500).json({ error: "internal_error" });
    }
});

(async () => {
    try {
        if (MONGO_URL) {
        await mongoose.connect(MONGO_URL);
        console.log("✅ orders connected to MongoDB");
        } else {
        console.log("⚠️ orders: MONGO_URL missing");
        }

        if (RABBIT_URL) {
        rabbitConn = await amqp.connect(RABBIT_URL);
        rabbitCh = await rabbitConn.createChannel();
        console.log("✅ orders connected to RabbitMQ");
        } else {
        console.log("⚠️ orders: RABBIT_URL missing (skipping rabbit)");
        }

        if (KAFKA_BROKERS) {
        const kafka = new Kafka({
            brokers: KAFKA_BROKERS.split(",").map((s) => s.trim()).filter(Boolean),
            ssl: KAFKA_SSL === "true",
            sasl: {
            mechanism: KAFKA_SASL_MECHANISM,
            username: KAFKA_SASL_USERNAME,
            password: KAFKA_SASL_PASSWORD,
            },
        });

        producer = kafka.producer();
        await producer.connect();
        console.log("✅ orders connected to Kafka (Redpanda)");
        } else {
        console.log("⚠️ orders: KAFKA_BROKERS missing (skipping kafka)");
        }

        app.listen(PORT, () => console.log(`🚀 orders service on ${PORT} (${INSTANCE_ID})`));
    } catch (err) {
        console.error("❌ orders startup error:", err);
        process.exit(1);
    }
})();

async function graceful() {
    console.log("🔻 shutting down orders ...");
    await Promise.allSettled([producer?.disconnect()]);
    await Promise.allSettled([rabbitCh?.close(), rabbitConn?.close()]);
    await Promise.allSettled([mongoose.connection?.close()]);
    process.exit(0);
}

process.on("SIGINT", graceful);
process.on("SIGTERM", graceful);
