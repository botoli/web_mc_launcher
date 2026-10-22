const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { startTestApp } = require("./test-app");
const { makeZip } = require("./zip-fixture");

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
        ["Nevermore", content],
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
    const firstZip = await zip("MZfirst");
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
              ["nested/Nevermore", "x"],
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
      url: `http://localhost:${app.backendPort}/download/launcher/0.1.1.zip`,
      sha256: crypto.createHash("sha256").update(firstZip).digest("hex"),
      size: firstZip.length,
    });
    assert.deepEqual(
      Buffer.from(await (await fetch(info.url)).arrayBuffer()),
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
      Buffer.from(await (await fetch(info.url)).arrayBuffer()),
      firstZip,
    );
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
    assert.equal(next.version, "0.1.2");
    assert.equal(
      next.url,
      `http://localhost:${app.backendPort}/download/launcher/0.1.2.zip`,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(info.url)).arrayBuffer()),
      firstZip,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(next.url)).arrayBuffer()),
      secondZip,
    );
  },
);
