import express from "express";
import cookieSession from "cookie-session";
import crypto from "node:crypto";
import "dotenv/config";
import {
  authorizeUrl, exchangeCodeForToken, getUserIdentity, getFile, commitAndOpenPR,
} from "./lib/github.js";

const {
  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
  GITHUB_OWNER, GITHUB_REPO, GITHUB_BASE_BRANCH = "main",
  APP_BASE_URL, OAUTH_CALLBACK_PATH = "/auth/github/callback",
  SESSION_SECRET, ALLOWED_LOGINS = "", PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({ GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_OWNER, GITHUB_REPO, APP_BASE_URL, SESSION_SECRET }))
  if (!v) throw new Error(`Missing required env var: ${k}`); // fail fast

const allowList = ALLOWED_LOGINS.split(",").map((s) => s.trim()).filter(Boolean);
const redirectUri = APP_BASE_URL.replace(/\/$/, "") + OAUTH_CALLBACK_PATH;

const app = express();
app.set("trust proxy", 1); // behind nginx TLS
app.use(express.json({ limit: "2mb" }));
app.use(cookieSession({
  name: "ari_sess",
  secret: SESSION_SECRET,
  httpOnly: true,
  sameSite: "lax",
  secure: APP_BASE_URL.startsWith("https"), // HTTPS in prod; allows http://localhost in dev
  maxAge: 8 * 60 * 60 * 1000,
}));

function requireAuth(req, res, next) {
  if (!req.session?.token) return res.status(401).json({ error: "not authenticated" });
  next();
}

// ---- OAuth: start ----
app.get("/auth/github", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.state = state;
  res.redirect(authorizeUrl({ clientId: GITHUB_CLIENT_ID, redirectUri, state }));
});

// ---- OAuth: callback ----
app.get(OAUTH_CALLBACK_PATH, async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== req.session.state)
      return res.status(400).send("Invalid OAuth state");
    const token = await exchangeCodeForToken({
      clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET,
      code: req.query.code, redirectUri,
    });
    const identity = await getUserIdentity(token);
    if (allowList.length && !allowList.includes(identity.login))
      return res.status(403).send(`@${identity.login} is not on the allow list.`);
    // token + identity kept server-side in the signed session cookie payload only
    req.session.token = token;
    req.session.identity = identity;
    req.session.state = null;
    res.redirect("/");
  } catch (e) {
    console.error("oauth callback error", e.message);
    res.status(500).send("Authentication failed");
  }
});

app.post("/auth/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

// ---- who am I (no token returned) ----
app.get("/api/me", (req, res) => {
  if (!req.session?.identity) return res.json({ authenticated: false });
  const { login, name, avatar } = req.session.identity;
  res.json({ authenticated: true, login, name, avatar });
});

// ---- read a file ----
app.get("/api/file", requireAuth, async (req, res) => {
  try {
    const path = String(req.query.path || "");
    if (!path) return res.status(400).json({ error: "path required" });
    const f = await getFile({ token: req.session.token, owner: GITHUB_OWNER, repo: GITHUB_REPO, path, ref: GITHUB_BASE_BRANCH });
    res.json(f);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- submit an edit (commit as user + open PR) ----
app.post("/api/commit", requireAuth, async (req, res) => {
  try {
    const { path, content, sha, message } = req.body || {};
    if (!path || content == null) return res.status(400).json({ error: "path and content required" });
    const out = await commitAndOpenPR({
      token: req.session.token, owner: GITHUB_OWNER, repo: GITHUB_REPO,
      baseBranch: GITHUB_BASE_BRANCH, path, newContent: content, sha, message,
      identity: req.session.identity,
    });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static("public"));
app.listen(PORT, () => console.log(`ARI editor on :${PORT} -> ${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BASE_BRANCH}`));
