// Front-end only. No secrets here — it talks to our backend, which holds the
// GitHub credentials. The user's token never reaches this code.
const $ = (id) => document.getElementById(id);
let currentSha = null;

async function refreshMe() {
  const me = await fetch("/api/me").then((r) => r.json());
  if (me.authenticated) {
    $("who").textContent = `@${me.login}`;
    if (me.avatar) { $("avatar").src = me.avatar; $("avatar").classList.remove("hidden"); }
    $("login").classList.add("hidden");
    $("logout").classList.remove("hidden");
    $("editor").classList.remove("hidden");
  } else {
    $("login").classList.remove("hidden");
    $("logout").classList.add("hidden");
    $("editor").classList.add("hidden");
  }
}
function setStatus(msg, ok) {
  const s = $("status"); s.classList.remove("hidden", "ok", "err");
  s.classList.add(ok ? "ok" : "err"); s.innerHTML = msg;
}

$("login").onclick = () => (location.href = "/auth/github");
$("logout").onclick = async () => { await fetch("/auth/logout", { method: "POST" }); location.reload(); };

$("load").onclick = async () => {
  const path = $("path").value.trim();
  const r = await fetch("/api/file?path=" + encodeURIComponent(path));
  if (!r.ok) return setStatus("Failed to load: " + (await r.text()), false);
  const f = await r.json();
  $("content").value = f.content; currentSha = f.sha;
  setStatus(f.sha ? "Loaded existing file." : "New file (does not exist yet).", true);
};

$("submit").onclick = async () => {
  const body = {
    path: $("path").value.trim(),
    content: $("content").value,
    sha: currentSha,
    message: $("message").value.trim(),
  };
  const r = await fetch("/api/commit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) return setStatus("Error: " + (out.error || "unknown"), false);
  setStatus(`Pull request opened: <a href="${out.prUrl}" target="_blank">#${out.prNumber}</a> (branch <code>${out.branch}</code>)`, true);
};

refreshMe();
