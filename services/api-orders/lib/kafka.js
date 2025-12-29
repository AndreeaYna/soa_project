import { Kafka } from "kafkajs";

export function makeKafka() {
    const kafka = new Kafka({
        clientId: process.env.KAFKA_CLIENT_ID || "orders-svc",
        brokers: process.env.KAFKA_BROKERS.split(","),
        ssl: process.env.KAFKA_SSL === "true",
        sasl: {
        mechanism: process.env.KAFKA_SASL_MECHANISM,      // scram-sha-256
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD,
        },
    });
    return kafka;
}
