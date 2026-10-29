import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Inspect paths only: local database contents never belong in source or CI logs.
export function localDatabasePaths(paths) {
  return paths.filter((path) => path.split("/").slice(0, -1).some((part) => part.startsWith(".devdb")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const blocked = localDatabasePaths(paths);
  if (blocked.length) {
    console.error(`Source contains ${blocked.length} tracked local database files. Remove the database directories from Git before merging.`);
    for (const path of blocked.slice(0, 5)) console.error(JSON.stringify(path));
    process.exitCode = 1;
  } else {
    console.log("Source tree excludes local database directories.");
  }
}
