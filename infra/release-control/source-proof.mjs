import { execFileSync } from "node:child_process";

const need = (condition, message) => { if (!condition) throw new Error(message); };
const shaPattern = /^[a-f0-9]{40}$/;
function repository(url) {
  need(typeof url === "string", "Public GitHub source URL required");
  const normalized = url.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  need(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized), "Public GitHub source URL required");
  return normalized;
}

/** Mutations require a clean pinned main checkout; status reads never call this checker. */
export function createSourceVerifier({ worktree, git, fetchImpl = fetch }) {
  const readGit = git ?? ((...argv) => {
    try { return execFileSync("git", argv, { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, windowsHide: true }).trim(); }
    catch { throw new Error("Local source check failed; raw command output withheld"); }
  });
  return async ({ sha, sourceUrl, buildspec, blobs }) => {
    need(typeof worktree === "string" && worktree.length > 0, "Explicit source worktree is required for mutation planning");
    need(shaPattern.test(sha ?? "") && buildspec === "infra/aws/buildspec.yml", "Exact source and reviewed buildspec required");
    need(blobs && Object.keys(blobs).length === 2 && [buildspec, "apps/api/Dockerfile"].every((p) => shaPattern.test(blobs[p] ?? "")), "Both reviewed build-file blobs are required");
    const expected = repository(sourceUrl);
    need(repository(readGit("remote", "get-url", "origin")) === expected, "Checkout remote differs from the reviewed source");
    need(readGit("status", "--porcelain") === "" && readGit("rev-parse", "HEAD") === sha && readGit("rev-parse", "origin/main") === sha, "Release checkout must be clean and exactly the reviewed main SHA");
    for (const [path, blob] of Object.entries(blobs)) need(readGit("rev-parse", `${sha}:${path}`) === blob, "Buildspec or Dockerfile differs from the reviewed blob");
    let response, data;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${expected.slice("https://github.com/".length)}/git/ref/heads/main`, { headers: { "User-Agent": "Dandelist-coordinated-release" }, signal: AbortSignal.timeout(15000) });
      if (response.ok) data = await response.json();
    } catch { throw new Error("Public main verification failed; raw response withheld"); }
    need(response?.ok && data?.object?.sha === sha, "Public main moved or could not be verified; review source again");
  };
}
