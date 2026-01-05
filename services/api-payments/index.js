import express from "express";
import amqp from "amqplib";
import { Kafka } from "kafkajs";
import "dotenv/config";

const {
    PORT = 3002,
    INSTANCE_ID = "payments-1",

    // RabbitMQ
    RABBIT_URL,

    // Kafka (Redpanda)
    KAFKA_CLIENT_ID = "payments-svc",
    KAFKA_BROKERS = "",
    KAFKA_SASL_MECHANISM = "scram-sha-256",
    KAFKA_SASL_USERNAME = "",
    KAFKA_SASL_PASSWORD = "",
    KAFKA_SSL = "true",
    PAYMENTS_GROUP_ID = "payments-group",
} = process.env;

const app = express();
app.get("/health", (_, res) => {
    res.set("X-Instance-Id", INSTANCE_ID);
    res.json({ ok: true, svc: "payments", instance: INSTANCE_ID });
});

let rabbitConn, rabbitCh;
let kafka, producer, consumer;

async function produceConfirmation({ orderId, amount, source }) {
    if (!producer) return;

    const msg = {
        type: "payment.charged",
        orderId: String(orderId),
        amount: Number(amount) || 0,
        source, // "rabbit" | "kafka"
        ts: Date.now(),
    };

    await producer.send({
        topic: "payments",
        messages: [{ key: msg.orderId, value: JSON.stringify(msg) }],
    });

    console.log(`✅ produced confirmation for order ${msg.orderId} via ${source}`);
}

async function startRabbitConsumer() {
    if (!RABBIT_URL) {
        console.log("⚠️ RABBIT_URL not set, skipping RabbitMQ consumer.");
        return;
    }

    rabbitConn = await amqp.connect(RABBIT_URL);
    rabbitCh = await rabbitConn.createChannel();
    await rabbitCh.assertQueue("charge", { durable: true });

    await rabbitCh.consume(
        "charge",
        async (msg) => {
        if (!msg) return;
        try {
            const payload = JSON.parse(msg.content.toString());
            console.log("🟢 payments (rabbit): received", payload);

            await produceConfirmation({
            orderId: payload.orderId,
            amount: payload.amount,
            source: "rabbit",
            });

            rabbitCh.ack(msg);
        } catch (err) {
            console.error("❌ rabbit consumer error:", err);
            rabbitCh.nack(msg, false, false);
        }
        },
        { noAck: false }
    );

    console.log("✅ RabbitMQ consumer started (queue: charge)");
}

async function startKafka() {
    if (!KAFKA_BROKERS) {
        console.log("⚠️ KAFKA_BROKERS not set, skipping Kafka.");
        return;
    }

    kafka = new Kafka({
        clientId: KAFKA_CLIENT_ID,
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
    console.log("✅ Kafka producer connected");

    consumer = kafka.consumer({ groupId: PAYMENTS_GROUP_ID });
    await consumer.connect();
    await consumer.subscribe({ topic: "orders", fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
        try {
            const payload = JSON.parse(message.value.toString());
            console.log("🟢 payments (kafka): received", payload);

            await produceConfirmation({
            orderId: payload.id,
            amount: payload.amount,
            source: "kafka",
            });
        } catch (err) {
            console.error("❌ kafka consumer error:", err);
        }
        },
    });

    console.log("✅ Kafka consumer started (topic: orders)");
}

(async () => {
    try {
        await Promise.all([startKafka(), startRabbitConsumer()]);
        app.listen(PORT, () => console.log(`🚀 payments on ${PORT} (${INSTANCE_ID})`));
    } catch (err) {
        console.error("❌ payments startup error:", err);
        process.exit(1);
    }
})();

async function shutdown() {
    console.log("🔻 shutting down payments ...");
    await Promise.allSettled([consumer?.disconnect(), producer?.disconnect()]);
    await Promise.allSettled([rabbitCh?.close(), rabbitConn?.close()]);
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
