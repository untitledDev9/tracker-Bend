require("dotenv").config();
const express        = require("express");
const cors           = require("cors");
const rateLimit      = require("express-rate-limit");
const jwt            = require("jsonwebtoken");
const Groq           = require("groq-sdk");
const { randomUUID } = require("crypto");

const connectDB = require("./db");
const Package   = require("./models/Package");
const Admin     = require("./models/Admin");

const app    = express();
const PORT   = process.env.PORT   || 4000;
const ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_production";

/* ── CORS ── */
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json());

/* ── JWT auth middleware ── */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/* ── AI rate limit — 20 requests / 10 min ── */
const aiLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: "Too many AI requests — please wait a few minutes." },
});

/* ── Seed DB on first start ── */
async function seedAdmin() {
  const exists = await Admin.findOne();
  if (exists) return;
  const username = process.env.ADMIN_USERNAME || "tobi";
  const password = process.env.ADMIN_PASSWORD || "assetfreight2025";
  await Admin.create({ username, password });
  console.log(`Default admin created → username: ${username}`);
}

async function seedPackage() {
  const count = await Package.countDocuments();
  if (count > 0) return;
  await Package.create({
    id: "AFKP3M748291NXQR65",
    description: "Sample Electronics Package",
    weight: "3.5 lbs",
    sender: "Asset Freight HQ, Los Angeles",
    recipient: "John Smith",
    transport: "truck",
    status: "in_transit",
    estimatedDelivery: "Jun 30, 5:00 PM",
    stops: [
      { id: randomUUID(), label: "Picked up from sender", location: "Asset Freight HQ", city: "Los Angeles", state: "CA", zip: "90001", country: "", date: "2025-06-24", time: "09:00", status: "done" },
      { id: randomUUID(), label: "Arrived at sorting hub", location: "FedEx Ground Hub", city: "Phoenix", state: "AZ", zip: "85001", country: "", date: "2025-06-25", time: "14:30", status: "done" },
      { id: randomUUID(), label: "In transit", location: "Highway 10 Corridor", city: "El Paso", state: "TX", zip: "79901", country: "", date: "2025-06-26", time: "08:00", status: "active" },
      { id: randomUUID(), label: "Out for delivery", location: "Local Delivery Hub", city: "Houston", state: "TX", zip: "77001", country: "", date: "2025-06-27", time: "10:00", status: "pending" },
      { id: randomUUID(), label: "Delivered", location: "123 Main Street", city: "Houston", state: "TX", zip: "77002", country: "", date: "2025-06-30", time: "17:00", status: "pending" },
    ],
  });
  console.log("Sample package seeded → TRK-0001-TRUCK");
}

/* ════════════════════════════════════════════
   AUTH ROUTES
   ════════════════════════════════════════════ */

/* Login */
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const admin = await Admin.findOne({ username: username.toLowerCase() });
  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await admin.verifyPassword(password);
  if (!ok)  return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: admin._id, username: admin.username }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, username: admin.username });
});

/* Change password */
app.put("/api/auth/password", requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Both fields required" });
  if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const admin = await Admin.findById(req.admin.id);
  const ok = await admin.verifyPassword(currentPassword);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  admin.password = newPassword;
  await admin.save();
  res.json({ message: "Password updated" });
});

/* ════════════════════════════════════════════
   PACKAGE ROUTES
   ════════════════════════════════════════════ */

/* Public: track a package */
app.get("/api/track/:id", async (req, res) => {
  const id  = req.params.id.toUpperCase();
  const pkg = await Package.findOne({ id });
  if (!pkg) return res.status(404).json({ error: `No package found for tracking ID "${id}"` });
  setTimeout(() => res.json(pkg.toClient()), 150);
});

/* Admin: list all packages */
app.get("/api/packages", requireAdmin, async (_req, res) => {
  const pkgs = await Package.find().sort({ createdAt: -1 });
  res.json(pkgs.map(p => p.toClient()));
});

/* Admin: create package */
app.post("/api/packages", requireAdmin, async (req, res) => {
  const body = req.body;
  if (!body.id || !body.stops?.length) return res.status(400).json({ error: "id and stops are required" });
  try {
    const pkg = await Package.create({ ...body, id: body.id.toUpperCase() });
    res.status(201).json(pkg.toClient());
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: `Package ID "${body.id}" already exists` });
    res.status(400).json({ error: err.message });
  }
});

/* Admin: update package (full replace) */
app.put("/api/packages/:id", requireAdmin, async (req, res) => {
  const id  = req.params.id.toUpperCase();
  const pkg = await Package.findOneAndUpdate(
    { id },
    { ...req.body, id },
    { new: true, runValidators: true }
  );
  if (!pkg) return res.status(404).json({ error: "Package not found" });
  res.json(pkg.toClient());
});

/* Admin: delete package */
app.delete("/api/packages/:id", requireAdmin, async (req, res) => {
  const id  = req.params.id.toUpperCase();
  const pkg = await Package.findOneAndDelete({ id });
  if (!pkg) return res.status(404).json({ error: "Package not found" });
  res.json({ deleted: id });
});

/* ════════════════════════════════════════════
   AI ROUTE
   ════════════════════════════════════════════ */

app.post("/api/ai/checkpoints", requireAdmin, aiLimit, async (req, res) => {
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

    const raw     = completion.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.status(500).json({ error: "AI returned invalid JSON. Try again." }); }

    const stops = (parsed.stops || []).map(s => ({
      id: randomUUID(), label: s.label || "In Transit",
      location: s.location || "", city: s.city || "",
      state: s.state || "", zip: s.zip || "",
      country: s.country || "", date: "", time: "", status: "pending",
    }));

    const found = stops.length, requested = Number(count);
    res.json({ partial: found < requested, found, requested, stops });

  } catch (err) {
    console.error("Groq error:", err.message);
    res.status(500).json({ error: err.message || "AI generation failed" });
  }
});

/* ── Start ── */
connectDB()
  .then(() => seedAdmin())
  .then(() => seedPackage())
  .then(() => {
    app.listen(PORT, () => console.log(`Asset Freight API  →  http://localhost:${PORT}  (origin: ${ORIGIN})`));
  })
  .catch(err => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
