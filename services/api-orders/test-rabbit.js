import amqp from "amqplib";
import dotenv from "dotenv";

dotenv.config();

const RABBIT_URL = process.env.RABBIT_URL;

async function testConnection() {
    try {
        console.log("Connecting to RabbitMQ...");
        const connection = await amqp.connect(RABBIT_URL);
        console.log("✅ Connected successfully to RabbitMQ!");

        const channel = await connection.createChannel();
        console.log("✅ Channel created successfully!");

        await channel.close();
        await connection.close();
        console.log("✅ Connection closed cleanly.");
    } catch (error) {
        console.error("❌ Connection failed:", error.message);
    }
}

testConnection();
