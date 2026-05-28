import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`hub listening on ${PORT}`));
