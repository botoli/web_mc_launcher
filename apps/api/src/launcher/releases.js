const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const archiver = require("archiver");
const yauzl = require("yauzl");
const crc32 = require("buffer-crc32");

const PLATFORM = "windows-x64";
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MODERN = "Nevermore.exe";
const LEGACY = "EquestrianDreamLauncher.exe";
const MAX_SIZE = 500 * 1024 * 1024;
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const conflict = () => Object.assign(new Error("Эта версия уже сохранена."), { status: 409 });
const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// Read every entry, including its CRC, rather than trusting the ZIP directory.
async function validateZip(buffer, executable = MODERN) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, value) => error ? reject(invalid("Не удалось прочитать ZIP-архив.")) : resolve(value)),
  );
  const files = new Map();
  try {
    await new Promise((resolve, reject) => {
      zip.on("error", () => reject(invalid("ZIP-архив повреждён.")));
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (![executable, "README.txt"].includes(name) || files.has(name) ||
            entry.generalPurposeBitFlag & 1 || entry.uncompressedSize > MAX_SIZE ||
            (type && type !== 0o100000) || (entry.externalFileAttributes & 0x10))
          return reject(invalid(`ZIP должен содержать только ${executable} и README.txt в корне.`));
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(invalid("ZIP-архив повреждён."));
          let checksum = 0, size = 0;
          const chunks = [];
          stream.on("error", () => reject(invalid("ZIP-архив повреждён.")));
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_SIZE) {
              stream.destroy();
              return reject(invalid("Файл в ZIP слишком большой."));
            }
            chunks.push(chunk);
            checksum = crc32.unsigned(chunk, checksum);
          });
          stream.on("end", () => {
            if (size !== entry.uncompressedSize || checksum !== entry.crc32)
              return reject(invalid("Файл в ZIP-архиве повреждён."));
            files.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => files.size === 2 ? resolve() :
        reject(invalid(`ZIP должен содержать только ${executable} и README.txt в корне.`)));
      zip.readEntry();
    });
    return files;
  } finally { zip.close(); }
}

function createLauncherReleases(dataDir) {
  const directory = path.join(dataDir, "launcher", "releases");
  const name = (version, legacy = false) => `${version}${legacy ? "-legacy" : ""}.zip`;
  function file(version, legacy = false) {
    return typeof version === "string" && VERSION.test(version) ? path.join(directory, name(version, legacy)) : null;
  }
  const metadata = (version, buffer, legacy = false) => ({
    file: name(version, legacy), sha256: digest(buffer), size: buffer.length,
  });
  async function compatibility(staging, source) {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const saved = pipeline(archive, createWriteStream(staging, { flags: "wx" }));
    archive.append(source.get(MODERN), { name: LEGACY });
    archive.append(source.get("README.txt"), { name: "README.txt" });
    await Promise.all([saved, archive.finalize()]);
  }
  async function verifyPair(modern, legacy) {
    const source = await validateZip(modern);
    const target = await validateZip(legacy, LEGACY);
    if (!source.get(MODERN).equals(target.get(LEGACY)) ||
        !source.get("README.txt").equals(target.get("README.txt")))
      throw invalid("Содержимое вариантов ZIP не совпадает.");
  }
  async function publish(upload, version, releases) {
    if (version.length > 64 || !VERSION.test(version))
      throw invalid("Укажите версию в формате 0.1.1 (не более 64 символов).");
    if (!upload || Array.isArray(upload) || !/\.zip$/i.test(upload.name))
      throw invalid("Выберите ZIP-архив лаунчера.");
    if (upload.truncated || upload.size > MAX_SIZE)
      throw Object.assign(new Error("Максимальный размер архива — 500 МБ."), { status: 413 });
    if (Object.hasOwn(releases || {}, version)) throw conflict();
    const source = await validateZip(upload.data);
    await fs.mkdir(directory, { recursive: true });
    const stage = await fs.mkdtemp(path.join(directory, ".publish-"));
    const linked = [];
    try {
      await fs.writeFile(path.join(stage, "modern.zip"), upload.data, { flag: "wx" });
      await compatibility(path.join(stage, "legacy.zip"), source);
      const modern = await fs.readFile(path.join(stage, "modern.zip"));
      const legacy = await fs.readFile(path.join(stage, "legacy.zip"));
      await verifyPair(modern, legacy);
      // Exclusive links never replace a published version or a failed commit's orphan.
      for (const [staged, target] of [["modern.zip", file(version)], ["legacy.zip", file(version, true)]]) {
        await fs.link(path.join(stage, staged), target);
        linked.push(target);
      }
      return { version, platform: PLATFORM, ...metadata(version, modern), legacy: metadata(version, legacy, true) };
    } catch (error) {
      await Promise.all(linked.map(target => fs.unlink(target)));
      if (error.code === "EEXIST") throw conflict();
      throw error;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  // Upgrade the existing current publication without changing its original ZIP.
  // A failure aborts startup and rolls back the catalog, leaving the publication intact.
  async function ensureCompatibility(release) {
    if (!release || release.legacy) return;
    const modern = await fs.readFile(file(release.version));
    if (digest(modern) !== release.sha256 || modern.length !== release.size)
      throw new Error("Опубликованный ZIP не соответствует метаданным.");
    const source = await validateZip(modern);
    const stage = await fs.mkdtemp(path.join(directory, ".migrate-"));
    const target = file(release.version, true);
    try {
      await compatibility(path.join(stage, "legacy.zip"), source);
      try { await fs.link(path.join(stage, "legacy.zip"), target); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      const legacy = await fs.readFile(target);
      await verifyPair(modern, legacy);
      release.legacy = metadata(release.version, legacy, true);
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  function select(release, userAgent = "") {
    return /^EquestrianDreamLauncher\/\S+/.test(userAgent) ? release?.legacy : release;
  }
  function url(version, legacy = false) {
    // A relative URL keeps downloads on the same HTTPS origin as the request.
    return `/download/launcher/${name(version, legacy)}`;
  }
  return { publish, ensureCompatibility, select, url, file, platform: PLATFORM };
}
module.exports = { createLauncherReleases };
