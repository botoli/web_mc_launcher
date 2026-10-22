const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { startTestApp } = require("./test-app");
const { makeZip, readZip } = require("./zip-fixture");

test(
  "Windows launcher ZIP releases are validated, immutable and admin-only",
  { timeout: 60000 },
  async (t) => {
    const app = await startTestApp();
    t.after(() => app.stop());
    const post = (route, body) =>
      fetch(`${app.baseURL}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const zip = (content) =>
      makeZip([
        ["Nevermore.exe", content],
        ["README.txt", "Install instructions"],
      ]);
    const form = (version, content, name = "launcher.zip") => {
      const body = new FormData();
      body.set("version", version);
      body.set("launcher", new Blob([content]), name);
      return body;
    };
    await post("/api/register", {
      login: "player",
      password: "test-password",
      nickname: "Player",
    });
    await post("/api/register", {
      login: "botoli1",
      password: "test-password",
      nickname: "Admin",
    });
    const player = await (
      await post("/api/auth", { login: "player", password: "test-password" })
    ).json();
    const admin = await (
      await post("/api/auth", { login: "botoli1", password: "test-password" })
    ).json();
    const upload = (token, body) =>
      fetch(`${app.baseURL}/api/upload-launcher`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
    const firstExe = Buffer.from([0x4d, 0x5a, 0x00, 0xff, 0x80, 0x0a]);
    const firstZip = await zip(firstExe);
    assert.equal(
      (await fetch(`${app.baseURL}/api/launcher-update?platform=windows-x64`))
        .status,
      404,
    );
    assert.equal(
      (await fetch(`${app.baseURL}/api/launcher-update?platform=linux`)).status,
      400,
    );
    assert.equal((await upload(null, form("0.1.1", firstZip))).status, 401);
    assert.equal(
      (await upload(player.token, form("0.1.1", firstZip))).status,
      403,
    );
    assert.equal(
      (await upload(admin.token, form("../bad", firstZip))).status,
      400,
    );
    assert.equal(
      (await upload(admin.token, form("0.1.1", Buffer.from("not a zip"))))
        .status,
      400,
    );
    assert.equal(
      (
        await upload(
          admin.token,
          form(
            "0.1.1",
            await makeZip([
              ["nested/Nevermore.exe", "x"],
              ["README.txt", "y"],
            ]),
          ),
        )
      ).status,
      400,
    );

    assert.equal(
      (await upload(admin.token, form("0.1.1", firstZip))).status,
      200,
    );
    let info = await (
      await fetch(`${app.baseURL}/api/launcher-update?platform=windows-x64`)
    ).json();
    assert.deepEqual(info, {
      version: "0.1.1",
      url: `/download/launcher/0.1.1.zip`,
      sha256: crypto.createHash("sha256").update(firstZip).digest("hex"),
      size: firstZip.length,
    });
    assert.deepEqual(
      Buffer.from(await (await fetch(new URL(info.url, app.baseURL))).arrayBuffer()),
      firstZip,
    );
    assert.deepEqual(
      await fs.readFile(
        path.join(app.fixture, "data/launcher/releases/0.1.1.zip"),
      ),
      firstZip,
    );
    assert.equal(
      (await upload(admin.token, form("0.1.1", await zip("MZreplacement"))))
        .status,
      409,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(new URL(info.url, app.baseURL))).arrayBuffer()),
      firstZip,
    );
    async function checkVariants(version, exe) {
      let legacyInfo;
      for (const userAgent of ["EquestrianDreamLauncher/0.1.3", "EquestrianDreamLauncher/0.1.25", "Nevermore/0.1.26", "Unknown/1.0", ""]) {
        const response = await fetch(`${app.baseURL}/api/launcher-update?platform=windows-x64`, {
          headers: { "User-Agent": userAgent }, redirect: "manual",
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("vary"), /User-Agent/i);
        const selected = await response.json();
        assert.deepEqual(Object.keys(selected).sort(), ["sha256", "size", "url", "version"]);
        assert.equal(selected.version, version);
        const legacy = userAgent.startsWith("EquestrianDreamLauncher/");
        assert.equal(selected.url, `/download/launcher/${version}${legacy ? "-legacy" : ""}.zip`);
        const download = await fetch(new URL(selected.url, app.baseURL), { redirect: "manual" });
        assert.equal(download.status, 200);
        assert.equal(download.headers.get("location"), null);
        const bytes = Buffer.from(await download.arrayBuffer());
        assert.equal(Number(download.headers.get("content-length")), bytes.length);
        assert.equal(selected.size, bytes.length);
        assert.equal(selected.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
        assert.deepEqual(await readZip(bytes, null), {
          [legacy ? "EquestrianDreamLauncher.exe" : "Nevermore.exe"]: Buffer.from(exe),
          "README.txt": Buffer.from("Install instructions"),
        });
        if (legacy) legacyInfo = selected;
      }
      return legacyInfo;
    }
    const originalLegacy = await checkVariants("0.1.1", firstExe);

    // A failure installing the second immutable file must not change current.
    const blockedLegacy = path.join(app.fixture, "data/launcher/releases/0.1.9-legacy.zip");
    await fs.writeFile(blockedLegacy, "existing immutable file");
    assert.equal((await upload(admin.token, form("0.1.9", await zip("MZfailed")))).status, 409);
    assert.equal(await fs.readFile(blockedLegacy, "utf8"), "existing immutable file");
    await assert.rejects(fs.stat(path.join(app.fixture, "data/launcher/releases/0.1.9.zip")), { code: "ENOENT" });
    assert.equal((await fetch(`${app.baseURL}/download/launcher/0.1.9-legacy.zip`)).status, 404);
    assert.deepEqual(await checkVariants("0.1.1", firstExe), originalLegacy);
    const invalidZip = await makeZip([["Nevermore.exe", "MZbad"], ["README.txt", "readme"], ["extra.txt", "forbidden"]]);
    assert.equal((await upload(admin.token, form("0.1.8", invalidZip))).status, 400);
    await checkVariants("0.1.1", firstExe);
    assert.match(
      await (await fetch(`${app.baseURL}/login`)).text(),
      /Скачать лаунчер/,
    );
    const profile = await fetch(`${app.baseURL}/profile`, {
      headers: { Cookie: `mc_launcher_token=${player.token}` },
    });
    assert.match(await profile.text(), /Скачать последнюю версию/);

    const secondZip = await zip("MZsecond");
    assert.equal(
      (await upload(admin.token, form("0.1.2", secondZip))).status,
      200,
    );
    const next = await (
      await fetch(`${app.baseURL}/api/launcher-update?platform=windows-x64`)
    ).json();
    await checkVariants("0.1.2", "MZsecond");
    assert.equal(next.version, "0.1.2");
    assert.equal(
      next.url,
      `/download/launcher/0.1.2.zip`,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(new URL(info.url, app.baseURL))).arrayBuffer()),
      firstZip,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(new URL(next.url, app.baseURL))).arrayBuffer()),
      secondZip,
    );
  },
);

test("Existing publications gain a verified compatibility ZIP without replacing published files", async (t) => {
  const { createLauncherReleases } = require("../apps/api/src/launcher/releases");
  const directory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "launcher-migration-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createLauncherReleases(directory);
  const version = "0.1.26";
  const exe = Buffer.from([0x4d, 0x5a, 0, 255, 128, 1]);
  const readme = Buffer.from("README\r\n");
  const original = await makeZip([["Nevermore.exe", exe], ["README.txt", readme]]);
  await fs.mkdir(path.dirname(store.file(version)), { recursive: true });
  await fs.writeFile(store.file(version), original);
  const release = { version, file: `${version}.zip`, sha256: crypto.createHash("sha256").update(original).digest("hex"), size: original.length };
  await store.ensureCompatibility(release);
  const legacy = await fs.readFile(store.file(version, true));
  assert.deepEqual(await readZip(legacy, null), { "EquestrianDreamLauncher.exe": exe, "README.txt": readme });
  assert.equal(release.legacy.sha256, crypto.createHash("sha256").update(legacy).digest("hex"));
  assert.equal(release.legacy.size, legacy.length);
  assert.deepEqual(await fs.readFile(store.file(version)), original);
  const restored = { ...release };
  delete restored.legacy;
  // Handles an orphan left between linking the archive and committing the DB.
  await store.ensureCompatibility(restored);
  assert.deepEqual(restored, release);
  assert.deepEqual(await fs.readFile(store.file(version, true)), legacy);
  await fs.writeFile(store.file(version, true), "damaged existing file");
  delete restored.legacy;
  await assert.rejects(store.ensureCompatibility(restored));
  assert.equal(restored.legacy, undefined);
  assert.equal(await fs.readFile(store.file(version, true), "utf8"), "damaged existing file");
  assert.deepEqual(await fs.readFile(store.file(version)), original);
  await assert.rejects(store.ensureCompatibility({ ...restored, sha256: "bad hash" }));
});
