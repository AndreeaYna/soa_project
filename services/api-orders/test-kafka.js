import { Kafka } from "kafkajs";
import dotenv from "dotenv";
dotenv.config();

const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: [process.env.KAFKA_BROKERS],
    ssl: true,
    sasl: {
        mechanism: process.env.KAFKA_SASL_MECHANISM,
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD
    }
});

const producer = kafka.producer();

async function run() {
    await producer.connect();
    await producer.send({
        topic: "orders",
        messages: [{ value: "Test order message" }]
    });
    console.log("✅ Message sent successfully!");
    await producer.disconnect();
}

run().catch(console.error);
