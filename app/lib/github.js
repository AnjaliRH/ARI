// All GitHub calls run server-side with a per-user token held only in the
// session. Tokens are never sent to the browser.
import { Octokit } from "@octokit/rest";

const GH = "https://github.com";
const API = "https://api.github.com";

// Step 1: build the URL we redirect the user to so they authorise with GitHub.
export function authorizeUrl({ clientId, redirectUri, state }) {
  const u = new URL(`${GH}/login/oauth/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "repo user:email"); // repo write + read verified emails
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}

// Step 2: exchange the ?code for that user's access token. Uses the client
// secret — server-side only.
export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch(`${GH}/login/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth token exchange failed: " + JSON.stringify(data));
  return data.access_token;
}

// Identify the signed-in user and pick the email used for commit attribution.
// The author email MUST be a *verified* email on the account for the commit to
// count toward their GitHub contributions.
export async function getUserIdentity(token) {
  const octokit = new Octokit({ auth: token });
  const { data: user } = await octokit.users.getAuthenticated();
  let email = user.email;
  try {
    const { data: emails } = await octokit.request("GET /user/emails");
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    if (primary) email = primary.email;
  } catch { /* user:email scope may be denied; fall back to profile email */ }
  if (!email) email = `${user.id}+${user.login}@users.noreply.github.com`;
  return { login: user.login, name: user.name || user.login, email, avatar: user.avatar_url };
}

// Read a file's current content + blob sha (sha needed to update it).
export async function getFile({ token, owner, repo, path, ref }) {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return { content: "", sha: null };
    throw e;
  }
}

// Commit an edit AS THE USER, on a fresh branch, then open a PR to the base
// branch. The commit author/committer are the signed-in user, so once the PR
// merges into the default branch the commit is attributed to them.
export async function commitAndOpenPR({ token, owner, repo, baseBranch, path, newContent, sha, message, identity }) {
  const octokit = new Octokit({ auth: token });

  const { data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const branch = `edit/${identity.login}/${ts}`;
  await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseRef.object.sha });

  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path, branch,
    message: message || `Update ${path}`,
    content: Buffer.from(newContent, "utf8").toString("base64"),
    sha: sha || undefined,
    author: { name: identity.name, email: identity.email },
    committer: { name: identity.name, email: identity.email },
  });

  const { data: pr } = await octokit.pulls.create({
    owner, repo, head: branch, base: baseBranch,
    title: message || `Edit ${path}`,
    body: `Edit to \`${path}\` submitted via the ARI editor by @${identity.login}.`,
  });
  return { branch, prNumber: pr.number, prUrl: pr.html_url };
}
