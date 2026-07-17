const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME || "drfh2zfu",
  api_key: process.env.CLOUD_API_KEY || "182364297485335",
  api_secret: process.env.CLOUD_API_SECRET || "FSX2FaHhhwrUsHhmDmww6vRn51Y",
});

const app = express();
const PORT = 3000;
const POSTS_FILE = path.join(__dirname, "posts.json");
const VISITS_FILE = path.join(__dirname, "visits.json");
const CONFIG_FILE = path.join(__dirname, "config.json");
const TMP_DIR = path.join(__dirname, "tmp");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const upload = multer({ dest: TMP_DIR });

app.use(express.json());

function isPrivateIP(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost" ||
    ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.");
}

async function getGeo(ip) {
  if (isPrivateIP(ip)) return "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`, { signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json();
    if (data.city) return `${data.city}, ${data.country}`;
    return data.country || "";
  } catch {
    return "";
  }
}

app.use((req, res, next) => {
  res.set('Accept-CH', 'Sec-CH-UA-Model, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version');
  res.set('Critical-CH', 'Sec-CH-UA-Model');
  next();
});

app.use(async (req, res, next) => {
  if (req.path === "/" || req.path === "/index.html") {
    let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    else if (ip === "::1") ip = "127.0.0.1";
    let deviceModel = req.headers["sec-ch-ua-model"] || "";
    if (deviceModel) deviceModel = deviceModel.replace(/"/g, "").trim();
    const visit = {
      ip,
      time: new Date().toISOString(),
      ua: req.headers["user-agent"] || "unknown",
      location: await getGeo(ip),
      deviceModel,
    };
    const visits = readVisits();
    visits.unshift(visit);
    if (visits.length > 500) visits.length = 500;
    writeVisits(visits);
  }
  next();
});

app.get("/api/debug-headers", (req, res) => {
  res.json({
    "sec-ch-ua-model": req.headers["sec-ch-ua-model"] || "(not sent)",
    "user-agent": req.headers["user-agent"] || "(missing)",
    "sec-ch-ua": req.headers["sec-ch-ua"] || "(not sent)",
    "sec-ch-ua-platform": req.headers["sec-ch-ua-platform"] || "(not sent)",
    "sec-ch-ua-platform-version": req.headers["sec-ch-ua-platform-version"] || "(not sent)",
  });
});

app.use(express.static(__dirname));

app.get("/adminpage", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

function readPosts() {
  try {
    return JSON.parse(fs.readFileSync(POSTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writePosts(posts) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

function readVisits() {
  try {
    return JSON.parse(fs.readFileSync(VISITS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeVisits(visits) {
  fs.writeFileSync(VISITS_FILE, JSON.stringify(visits, null, 2));
}

app.get("/api/posts", (req, res) => {
  res.json(readPosts());
});

app.post("/api/posts", upload.single("image"), async (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: "type and content required" });
  let imageUrl = null;
  if (req.file) {
    try {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "shamsul-thoughts" });
      imageUrl = result.secure_url;
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  }
  const posts = readPosts();
  const newPost = {
    id: Date.now().toString(),
    type,
    content,
    image: imageUrl,
    date: new Date().toISOString().slice(0, 10),
  };
  posts.unshift(newPost);
  writePosts(posts);
  res.json(newPost);
});

app.delete("/api/posts/:id", (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "id required" });
  let posts = readPosts();
  const before = posts.length;
  posts = posts.filter(p => p.id !== id);
  if (posts.length === before) return res.status(404).json({ error: "post not found" });
  writePosts(posts);
  res.json({ ok: true });
});

app.get("/api/visits", (req, res) => {
  res.json(readVisits());
});

app.delete("/api/visits/:index", (req, res) => {
  const visits = readVisits();
  const i = parseInt(req.params.index, 10);
  if (i < 0 || i >= visits.length) return res.status(404).json({ error: "not found" });
  visits.splice(i, 1);
  writeVisits(visits);
  res.json({ ok: true });
});

app.post("/api/device-model", (req, res) => {
  const body = req.body || {};
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  else if (ip === "::1") ip = "127.0.0.1";
  let headerModel = req.headers["sec-ch-ua-model"] || "";
  if (headerModel) headerModel = headerModel.replace(/"/g, "").trim();
  const model = headerModel || body.model || "";
  const visits = readVisits();
  for (const v of visits) {
    if (v.ip === ip && !v.deviceModel) {
      if (model) v.deviceModel = model;
      v.deviceInfo = {
        platform: body.platform || "",
        platformVersion: body.platformVersion || "",
        screen: body.screen || "",
        dpr: body.dpr || "",
        cores: body.cores || "",
        memory: body.memory || "",
        brands: body.brands || "",
        headerModel: headerModel || "",
      };
      break;
    }
  }
  writeVisits(visits);
  res.json({ ok: true });
});

app.get("/api/visits/clear", (req, res) => {
  writeVisits([]);
  res.json({ ok: true });
});

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

app.get("/api/config", (req, res) => {
  res.json(readConfig());
});

app.put("/api/config", (req, res) => {
  const config = req.body;
  writeConfig(config);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});
