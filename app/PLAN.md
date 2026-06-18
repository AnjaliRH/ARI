# ARI GitHub Editor — per-user identity, hosted on AWS Lightsail

A small web app that lets approved people edit files in this repo from the
browser. Each person signs in **with their own GitHub account**, and their
edits are committed **under their own GitHub identity** via a pull request.

## 1. How it stays secret-safe

The only persistent secret is the OAuth App **client secret**, and it lives
**only on the Lightsail server**. The flow:

```
Browser ──(1) Sign in──▶ GitHub  ──(2) ?code──▶  Backend (Lightsail)
                                                   │  exchanges code+client_secret
                                                   │  for THIS user's access token
Browser ◀── session cookie ──────────────────────┘  (token stored server-side only)

Browser ──(edit + Submit)──▶ Backend ──(user's token)──▶ GitHub API: commit + open PR
```

- The browser never receives any GitHub token or the client secret.
- Each user's access token is held in the server-side session only (signed,
  HttpOnly, Secure cookie payload) and used solely for that user's requests.
- nginx hard-denies `.git`, `.env`, and dotfiles; secrets are never web-served.

## 2. Per-user identity & contribution attribution — **confirmed: yes**

Because the app commits with the **signed-in user's** OAuth token and sets the
commit `author`/`committer` to that user, the commit is attributed to them on
GitHub. For it to show on their **contribution graph (green squares)** all of
the following must hold — the app is built to satisfy them:

1. **Author email is a verified email on their account.** The app requests the
   `user:email` scope and uses their primary *verified* email as the commit
   author. (If unavailable it falls back to their `@users.noreply.github.com`
   address, which also counts.)
2. **The commit lands on the default branch.** Contributions count when commits
   are on the default branch (e.g. `main`) or come in through a **merged pull
   request**. The app commits to a per-edit branch and opens a PR; once that PR
   is merged into `main`, the commit counts for that user.
3. **They have access to the repo** (collaborator or org member). With
   per-user OAuth that is naturally true — they signed in as themselves.

Notes:
- Commits sitting only on the un-merged edit branch show as authored by the
  user but won't turn the graph green until merged.
- These commits are *attributed* (name + avatar shown) but not GPG-*verified*;
  verification needs a signing key, which is out of scope for a web editor.
- Private-repo contributions only appear on the public graph if the user opts
  in (Profile settings → "Include private contributions").

## 3. What's in this scaffold (`app/`)

| File | Purpose |
| --- | --- |
| `server.js` | Express app: OAuth routes, session, `/api/file`, `/api/commit` |
| `lib/github.js` | OAuth token exchange, identity lookup, commit + PR via Octokit |
| `public/index.html`, `public/app.js` | Minimal editor UI (no secrets client-side) |
| `.env.example` | Required server-side config (copy to `.env`, never commit) |
| `deploy/nginx.conf` | TLS reverse proxy; denies `.git`/`.env`/dotfiles |
| `deploy/ari-editor.service` | systemd unit running the app as an unprivileged user |

## 4. Hosting on AWS Lightsail — step by step

### 4.1 Create the GitHub OAuth App
1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. Homepage URL: `https://editor.example.com`
   Authorization callback URL: `https://editor.example.com/auth/github/callback`
3. Generate a client secret. Note the **Client ID** and **Client secret**.
   (Per-user OAuth App — not a GitHub App — so commits carry each user's identity.)

### 4.2 Provision the instance
1. Lightsail → Create instance → Linux/Unix → **Ubuntu 22.04**, smallest plan is fine.
2. Networking → attach a **static IP**; open ports **80** and **443** in the firewall.
3. Point your domain's A record at the static IP.

### 4.3 Install runtime
```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/ari-editor ariapp
```

### 4.4 Deploy the app
```bash
sudo -u ariapp git clone https://github.com/KrishnaTO/ARI.git /opt/ari-editor/src
sudo -u ariapp cp -r /opt/ari-editor/src/app /opt/ari-editor/app
cd /opt/ari-editor/app
sudo -u ariapp npm install --omit=dev
sudo -u ariapp cp .env.example .env
sudo -u ariapp nano .env       # fill in client id/secret, domain, SESSION_SECRET=$(openssl rand -hex 32)
sudo chmod 600 .env            # secrets readable only by ariapp
```

### 4.5 Run as a service
```bash
sudo cp deploy/ari-editor.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ari-editor
sudo systemctl status ari-editor
```

### 4.6 nginx + TLS
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ari-editor
# edit server_name to your domain, then:
sudo ln -s /etc/nginx/sites-available/ari-editor /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d editor.example.com   # issues + wires up the TLS cert
```

### 4.7 Verify
- Visit `https://editor.example.com`, click **Sign in with GitHub**, authorise.
- Load `data/README.md`, make an edit, **Submit** → a PR opens on the repo
  authored by you. Merge it and confirm the commit shows on your contributions.

## 5. Hardening checklist
- [ ] `.env` is `chmod 600`, owned by `ariapp`, and **git-ignored** (it is).
- [ ] App bound to `127.0.0.1:3000`; only nginx is public.
- [ ] `ALLOWED_LOGINS` set if you want to restrict who can edit.
- [ ] HTTPS enforced (80 → 443 redirect); session cookie `Secure`+`HttpOnly`.
- [ ] Rotate the OAuth client secret periodically; revoke if leaked.
- [ ] Keep edits flowing through PRs (branch protection on `main` for review).

## 6. Why OAuth App (not GitHub App or PAT) here
A single bot (GitHub App / shared PAT) would attribute every commit to the bot,
not the editor. Per-user OAuth makes each commit genuinely theirs — which is
exactly the contribution-attribution requirement.
