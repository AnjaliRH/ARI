// Diseases browser front-end. No secrets here — talks to the backend, which
// holds GitHub credentials. Reads the dataset from /diseases.json (read-only
// display); edits are committed to data/diseases.json as a PR under the user.
const $ = (id) => document.getElementById(id);
let DISEASES = [];     // full dataset in memory
let selected = null;   // currently selected disease (ari)

async function me() {
  const m = await fetch("/api/me").then((r) => r.json());
  if (m.authenticated) {
    $("who").textContent = "@" + m.login;
    if (m.avatar) { $("avatar").src = m.avatar; $("avatar").classList.remove("hidden"); }
    $("login").classList.add("hidden"); $("logout").classList.remove("hidden");
  }
  return m;
}
$("login").onclick = () => (location.href = "/auth/github");
$("logout").onclick = async () => { await fetch("/api/logout", { method: "POST" }).catch(()=>{}); await fetch("/auth/logout",{method:"POST"}); location.reload(); };

function fillFilters() {
  const tissues = [...new Set(DISEASES.map((d) => d.tissue).filter(Boolean))].sort();
  const ev = [...new Set(DISEASES.map((d) => d.evidence).filter(Boolean))].sort();
  for (const t of tissues) $("tissue").insertAdjacentHTML("beforeend", `<option>${t}</option>`);
  for (const e of ev) $("evidence").insertAdjacentHTML("beforeend", `<option>${e}</option>`);
}

function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const t = $("tissue").value, e = $("evidence").value, nc = $("nocode").checked;
  return DISEASES.filter((d) => {
    if (t && d.tissue !== t) return false;
    if (e && d.evidence !== e) return false;
    if (nc && !d.code_status) return false;
    if (!q) return true;
    return [d.name, d.synonyms, d.subtypes, d.ari, d.snomed, d.omop, d.dxcode]
      .join(" ").toLowerCase().includes(q);
  });
}

function renderList() {
  const rows = filtered();
  $("count").textContent = `${rows.length} of ${DISEASES.length} diseases`;
  $("items").innerHTML = rows.map((d) => `
    <div class="item ${d.ari === selected ? "sel" : ""}" data-ari="${d.ari}">
      <div class="nm">${esc(d.name)}</div>
      <div class="meta">
        <span class="badge">${esc(d.tissue || "—")}</span>
        ${d.code_status ? `<span class="badge nocode">${esc(d.code_status)}</span>` : ""}
        ${esc(d.ari)}
      </div>
    </div>`).join("");
  for (const el of $("items").children) el.onclick = () => selectDisease(el.dataset.ari);
}

function field(label, key, val, multiline) {
  const v = esc(val || "");
  return `<div class="fld"><label>${label}</label>${
    multiline ? `<textarea data-k="${key}">${v}</textarea>` : `<input data-k="${key}" value="${v}">`}</div>`;
}

function selectDisease(ari) {
  selected = ari; renderList();
  const d = DISEASES.find((x) => x.ari === ari);
  const authed = !$("logout").classList.contains("hidden");
  $("detail").innerHTML = `
    <h2>${esc(d.name)}</h2>
    <div class="muted">${esc(d.ari)} · <a href="${esc(d.iri)}" target="_blank">IRI</a></div>
    ${field("Preferred name","name",d.name)}
    ${field("Synonyms (; separated)","synonyms",d.synonyms)}
    ${field("Subtypes (; separated)","subtypes",d.subtypes)}
    <div class="grid2">
      ${field("SNOMED code(s)","snomed",d.snomed)}
      ${field("OMOP ConceptID","omop",d.omop)}
      ${field("Concept code (DXCODE)","dxcode",d.dxcode)}
      ${field("Obsolete SNOMED","snomed_obsolete",d.snomed_obsolete)}
      ${field("Tissue region","tissue",d.tissue)}
      ${field("Evidence level","evidence",d.evidence)}
      ${field("Autoimmune modifier","autoimmune",d.autoimmune)}
      ${field("Code status","code_status",d.code_status)}
    </div>
    ${field("Definition","definition",d.definition,true)}
    ${field("Definition source(s)","def_source",d.def_source)}
    <hr>
    ${authed ? `
      <div class="fld"><label>Commit message</label><input id="msg" value="Update ${esc(d.name)}"></div>
      <button id="save">Submit change (opens PR)</button>
      <div id="status" class="hidden"></div>`
      : `<p class="muted">Sign in with GitHub to edit and submit a pull request.</p>`}
  `;
  if (authed) $("save").onclick = () => submit(ari);
}

async function submit(ari) {
  const d = DISEASES.find((x) => x.ari === ari);
  for (const el of $("detail").querySelectorAll("[data-k]")) d[el.dataset.k] = el.value;
  setStatus("Submitting…", true);
  // fetch current data file (for its sha) then commit the full updated dataset
  const cur = await fetch("/api/file?path=data/diseases.json").then((r) => r.json()).catch(() => ({ sha: null }));
  const res = await fetch("/api/commit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "data/diseases.json",
      content: JSON.stringify(DISEASES, null, 2),
      sha: cur.sha || null,
      message: $("msg").value.trim() || `Update ${d.name}`,
    }),
  });
  const out = await res.json();
  if (!res.ok) return setStatus("Error: " + (out.error || "unknown"), false);
  setStatus(`Pull request opened: <a href="${out.prUrl}" target="_blank">#${out.prNumber}</a>`, true);
  renderList();
}

function setStatus(html, ok) {
  const s = $("status"); if (!s) return;
  s.classList.remove("hidden","ok","err"); s.classList.add(ok ? "ok" : "err"); s.innerHTML = html;
}
function esc(s){return String(s).replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

(async function init() {
  await me();
  DISEASES = await fetch("/diseases.json").then((r) => r.json());
  $("gate").classList.add("hidden"); $("app").classList.remove("hidden");
  fillFilters(); renderList();
  for (const el of ["q","tissue","evidence","nocode"]) $(el).addEventListener("input", renderList);
})();
