// pcr-gh.js — tiny GitHub data client for the admin page.
//
// The live data files (data/*.json) are committed straight to the repo through
// GitHub's API, so no backend server is involved. Reads/writes use the Git Data
// API so one admin action — which can touch several files — becomes ONE atomic
// commit. If someone else committed in between (the branch moved), the whole
// action is re-read and re-applied, up to a few times, instead of overwriting.
//
//   const gh = PCRGh.create({ owner, repo, branch, token, core: PCRCore });
//   await gh.testAccess();                          // who am I, can I read, can I write
//   await gh.readState();                           // { head, state }
//   await gh.mutate(state => PCRCore.applyBatch(state, input, ctx), "commit message");
//
// Errors are GhError with .kind: network | auth | forbidden | notfound | ratelimit |
// conflict | corrupt | invalid | http.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PCRGh = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class GhError extends Error {
    constructor(kind, message, status) { super(message || kind); this.kind = kind; this.status = status; }
  }

  function create(cfg) {
    const { owner, repo, branch, token, core } = cfg;
    const doFetch = cfg.fetch || ((...a) => fetch(...a));
    const API = "https://api.github.com";
    const repoPath = "/repos/" + owner + "/" + repo;
    const FILES = core.FILES;

    async function req(method, path, body, raw) {
      let res;
      try {
        res = await doFetch(API + path, {
          method,
          headers: Object.assign(
            { Authorization: "Bearer " + token, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" },
            body !== undefined ? { "Content-Type": "application/json" } : {}
          ),
          body: body !== undefined ? JSON.stringify(body) : undefined,
          cache: "no-store",
        });
      } catch (e) { throw new GhError("network", "network error"); }
      if (res.ok) return raw ? res.text() : res.json();
      let msg = "";
      try { msg = (await res.json()).message || ""; } catch (e) {}
      const remaining = res.headers && res.headers.get && res.headers.get("x-ratelimit-remaining");
      if (res.status === 401) throw new GhError("auth", msg, 401);
      if (res.status === 403 && remaining === "0") throw new GhError("ratelimit", msg, 403);
      if (res.status === 403) throw new GhError("forbidden", msg, 403);
      if (res.status === 404) throw new GhError("notfound", msg, 404);
      if (res.status === 409) throw new GhError("conflict", msg, 409);
      if (res.status === 422) throw new GhError("invalid", msg, 422);
      throw new GhError("http", msg, res.status);
    }

    async function headSha() {
      const r = await req("GET", repoPath + "/git/ref/heads/" + branch);
      return r.object.sha;
    }

    // null if the file doesn't exist at that commit
    async function readText(path, ref) {
      try { return await req("GET", repoPath + "/contents/" + path + "?ref=" + ref, undefined, true); }
      catch (e) { if (e.kind === "notfound") return null; throw e; }
    }

    // All data files as of one commit, so the state is internally consistent.
    async function readState() {
      const head = await headSha();
      const keys = Object.keys(FILES);
      const texts = await Promise.all(keys.map(k => readText(FILES[k], head)));
      const raw = {};
      keys.forEach((k, i) => {
        if (texts[i] === null) return;
        try { raw[k] = JSON.parse(texts[i]); }
        catch (e) { throw new GhError("corrupt", FILES[k] + " is not valid JSON"); }
      });
      return { head, state: core.normalizeState(raw) };
    }

    // One commit containing every changed file; fails with kind "conflict" if the
    // branch has moved since `head` was read.
    async function commit(head, changes, message) {
      const base = await req("GET", repoPath + "/git/commits/" + head);
      const entries = Object.entries(changes);
      const blobs = await Promise.all(entries.map(([, content]) =>
        req("POST", repoPath + "/git/blobs", { content, encoding: "utf-8" })));
      const tree = entries.map(([path], i) => ({ path, mode: "100644", type: "blob", sha: blobs[i].sha }));
      const newTree = await req("POST", repoPath + "/git/trees", { base_tree: base.tree.sha, tree });
      const newCommit = await req("POST", repoPath + "/git/commits", { message, tree: newTree.sha, parents: [head] });
      try {
        await req("PATCH", repoPath + "/git/refs/heads/" + branch, { sha: newCommit.sha, force: false });
      } catch (e) {
        if (e.kind === "invalid" || e.kind === "conflict") throw new GhError("conflict", "the data changed while saving", 422);
        throw e;
      }
      return newCommit.sha;
    }

    // Read the latest state, let fn(state) change it in place, and commit only the
    // files that actually changed. If fn returns {error}, nothing is written.
    async function mutate(fn, message) {
      for (let attempt = 1; ; attempt++) {
        const { head, state } = await readState();
        const before = {};
        Object.keys(FILES).forEach(k => { before[k] = JSON.stringify(state[k]); });
        const result = fn(state);
        if (result && result.error) return { result, state, head, committed: false };
        const changes = {};
        Object.keys(FILES).forEach(k => {
          if (JSON.stringify(state[k]) !== before[k]) changes[FILES[k]] = core.serialize(state[k]);
        });
        if (!Object.keys(changes).length) return { result, state, head, committed: false };
        try {
          const newHead = await commit(head, changes, typeof message === "function" ? message(result) : message);
          return { result, state, head: newHead, committed: true, attempts: attempt };
        } catch (e) {
          if (e.kind === "conflict" && attempt < 4) continue; // someone else committed: re-read and re-apply
          throw e;
        }
      }
    }

    // Who the token belongs to, whether it can read the repo, and whether it can
    // write (creating an unreferenced blob needs write access and changes nothing visible).
    async function testAccess() {
      const out = { login: null, read: false, write: false };
      try { out.login = (await req("GET", "/user")).login; }
      catch (e) { if (e.kind !== "forbidden" && e.kind !== "notfound") throw e; }
      await headSha();
      out.read = true;
      try {
        await req("POST", repoPath + "/git/blobs", { content: "pcr-admin connection test", encoding: "utf-8" });
        out.write = true;
      } catch (e) {
        if (e.kind !== "forbidden" && e.kind !== "notfound") throw e;
      }
      return out;
    }

    return { readState, mutate, commit, headSha, testAccess };
  }

  return { create, GhError };
});
