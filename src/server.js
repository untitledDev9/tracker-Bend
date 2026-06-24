require("dotenv").config();
const express        = require("express");
const cors           = require("cors");
const Groq           = require("groq-sdk");
const { randomUUID } = require("crypto");
const seedData       = require("./data/packages");

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

/* In-memory store, seeded with mock data */
const db = { ...seedData };

/* ── Public: track a package ── */
app.get("/api/track/:id", (req, res) => {
  const id  = req.params.id.toUpperCase();
  const pkg = db[id];
  if (!pkg) return res.status(404).json({ error: `No package found for tracking ID "${id}"` });
  setTimeout(() => res.json(pkg), 150);
});

/* ── Admin: list all packages ── */
app.get("/api/packages", (_req, res) => {
  res.json(Object.values(db));
});

/* ── Admin: create package ── */
app.post("/api/packages", (req, res) => {
  const pkg = req.body;
  if (!pkg.id || !pkg.stops?.length) return res.status(400).json({ error: "id and stops are required" });
  db[pkg.id.toUpperCase()] = pkg;
  res.status(201).json(pkg);
});

/* ── Admin: update package (full replace) ── */
app.put("/api/packages/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  if (!db[id]) return res.status(404).json({ error: "Package not found" });
  db[id] = { ...req.body, id };
  res.json(db[id]);
});

/* ── Admin: update stop status only ── */
app.patch("/api/packages/:id/stops/:stopIndex", (req, res) => {
  const id  = req.params.id.toUpperCase();
  const idx = parseInt(req.params.stopIndex, 10);
  const pkg = db[id];
  if (!pkg) return res.status(404).json({ error: "Package not found" });

  pkg.stops = pkg.stops.map((s, i) => ({
    ...s,
    status: i < idx ? "done" : i === idx ? "active" : "pending",
  }));
  pkg.status = idx === pkg.stops.length - 1 ? "delivered" : "in_transit";

  res.json(pkg);
});

/* ── Admin: delete package ── */
app.delete("/api/packages/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  if (!db[id]) return res.status(404).json({ error: "Package not found" });
  delete db[id];
  res.json({ deleted: id });
});

/* ── AI: generate route checkpoints via Groq ── */
app.post("/api/ai/checkpoints", async (req, res) => {
  const { pickup, dropoff, transport, count = 3 } = req.body;

  if (!pickup || !dropoff) {
    return res.status(400).json({ error: "pickup and dropoff locations are required" });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key || key === "your_groq_api_key_here") {
    return res.status(500).json({ error: "GROQ_API_KEY is not configured in backend/.env" });
  }

  const modeLabels = {
    bike:  "bicycle courier (city delivery)",
    truck: "road freight / semi-truck",
    plane: "air freight / cargo aircraft",
    ship:  "sea freight / cargo ship",
  };

  const prompt = `You are a logistics routing expert for Asset Freight Delivery Cargo.

A package is being shipped FROM: "${pickup}" TO: "${dropoff}" via ${modeLabels[transport] || transport}.

Generate exactly ${count} real, geographically accurate intermediate checkpoints a package would physically pass through along this route — in transit order.

Rules:
- Checkpoints must be real places between origin and destination (not the origin or destination themselves)
- Use real city names, distribution hubs, port names, airports, or sorting facilities
- Truck routes: use interstate corridor cities and regional distribution centers
- Air freight: include cargo terminal, airline hub city, and destination airport area
- Ships: use real seaport names along the shipping lane
- Bike couriers: use real district or neighborhood names within the same city
- If you cannot confidently find ${count} distinct verified checkpoints, return as many as you can and set "partial": true

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "partial": false,
  "found": ${count},
  "stops": [
    {
      "label": "Short action label e.g. Departed Sorting Hub",
      "location": "Facility or place name e.g. FedEx Ground Memphis Hub",
      "city": "City name",
      "state": "2-letter US state code, or empty string if international",
      "zip": "",
      "country": "Country name if not USA, otherwise empty string"
    }
  ]
}`;

  try {
    const groq = new Groq({ apiKey: key });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 1800,
    });

    const raw = completion.choices[0].message.content.trim();

    let parsed;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON. Try again.", raw });
    }

    /* Normalise stops — add IDs and default fields */
    const stops = (parsed.stops || []).map(s => ({
      id:       randomUUID(),
      label:    s.label    || "In Transit",
      location: s.location || "",
      city:     s.city     || "",
      state:    s.state    || "",
      zip:      s.zip      || "",
      country:  s.country  || "",
      date:     "",
      time:     "",
      status:   "pending",
    }));

    const found     = stops.length;
    const requested = Number(count);
    const partial   = found < requested;

    res.json({ partial, found, requested, stops });

  } catch (err) {
    console.error("Groq error:", err.message);
    res.status(500).json({ error: err.message || "AI generation failed" });
  }
});

app.listen(PORT, () => console.log(`Asset Freight API  →  http://localhost:${PORT}`));
