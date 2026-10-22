const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const yauzl = require("yauzl");
const crc32 = require("buffer-crc32");

const PLATFORM = "windows-x64";
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MAX_SIZE = 500 * 1024 * 1024;
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

async function validateZip(buffer) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: false,
        strictFileNames: true,
      },
      (error, value) =>
        error
          ? reject(invalid("Не удалось прочитать ZIP-архив."))
          : resolve(value),
    ),
  );
  try {
    const found = new Set();
    await new Promise((resolve, reject) => {
      zip.on("error", () => reject(invalid("ZIP-архив повреждён.")));
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        if (
          !["Nevermore", "README.txt"].includes(name) ||
          found.has(name) ||
          entry.generalPurposeBitFlag & 1 ||
          entry.uncompressedSize > MAX_SIZE
        )
          return reject(
            invalid("ZIP должен содержать Nevermore и README.txt в корне."),
          );
        found.add(name);
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(invalid("ZIP-архив повреждён."));
          let checksum = 0;
          let size = 0;
          stream.on("error", () => reject(invalid("ZIP-архив повреждён.")));
          stream.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_SIZE) {
              stream.destroy();
              return reject(invalid("Файл в ZIP слишком большой."));
            }
            checksum = crc32.unsigned(chunk, checksum);
          });
          stream.on("end", () => {
            if (size !== entry.uncompressedSize || checksum !== entry.crc32)
              return reject(invalid("Файл в ZIP-архиве повреждён."));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () =>
        found.size === 2
          ? resolve()
          : reject(
              invalid("ZIP должен содержать Nevermore и README.txt в корне."),
            ),
      );
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

function createLauncherReleases(dataDir, publicURL) {
  const directory = path.join(dataDir, "launcher", "releases");
  async function publish(upload, version, releases) {
    if (version.length > 64 || !VERSION.test(version))
      throw invalid("Укажите версию в формате 0.1.1 (не более 64 символов).");
    if (!upload || Array.isArray(upload) || !/\.zip$/i.test(upload.name))
      throw invalid("Выберите ZIP-архив лаунчера.");
    if (upload.truncated || upload.size > MAX_SIZE)
      throw Object.assign(new Error("Максимальный размер архива — 500 МБ."), {
        status: 413,
      });
    if (releases?.[version])
      throw Object.assign(new Error("Эта версия уже опубликована."), {
        status: 409,
      });
    await validateZip(upload.data);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, `${version}.zip`);
    const staging = path.join(directory, `.${crypto.randomUUID()}.upload`);
    try {
      await upload.mv(staging);
      // Hash the saved bytes, so metadata describes the actual downloadable file.
      const hash = crypto.createHash("sha256");
      for await (const chunk of require("node:fs").createReadStream(staging))
        hash.update(chunk);
      const sha256 = hash.digest("hex");
      const size = (await fs.stat(staging)).size;
      // Link fails if the immutable version already exists, including an orphan from a failed DB commit.
      await fs.link(staging, target);
      return {
        version,
        platform: PLATFORM,
        file: `${version}.zip`,
        sha256,
        size,
      };
    } catch (error) {
      if (error.code === "EEXIST")
        throw Object.assign(new Error("Эта версия уже сохранена."), {
          status: 409,
        });
      throw error;
    } finally {
      await fs.rm(staging, { force: true });
    }
  }
  function url(version) {
    return `${publicURL}/download/launcher/${version}.zip`;
  }
  function file(version) {
    return VERSION.test(version)
      ? path.join(directory, `${version}.zip`)
      : null;
  }
  return { publish, url, file, platform: PLATFORM };
}

module.exports = { createLauncherReleases };
