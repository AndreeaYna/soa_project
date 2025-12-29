// test-db.js
const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGO_URL;

async function run() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("✅ Connected successfully to MongoDB!");
        const db = client.db("orders");
        const collections = await db.listCollections().toArray();
        console.log("Collections found:", collections.map(c => c.name));
    } catch (err) {
        console.error("❌ Connection error:", err.message);
    } finally {
        await client.close();
    }
}

run();
