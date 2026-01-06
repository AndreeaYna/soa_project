import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        service: "fraud-faas",
        status: "running",
        endpoints: ["POST /fraud-check"]
    });
});

app.get("/health", (req, res) => {
    res.json({ ok: true });
});

app.post("/fraud-check", (req, res) => {
    const amount = Number(req.body.amount || 0);
    const score = amount > 100 ? 0.9 : 0.1;
    res.json({ score });
});

app.listen(3050, () =>
    console.log("🧠 fraud FaaS on 3050")
);
