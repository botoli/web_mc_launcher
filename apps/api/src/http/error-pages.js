const { renderErrorPage, errorPages } = require("../../../shared/error-pages");

function sendErrorPage(res, status) {
  res
    .status(status)
    .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
  if (status === 503) res.set("Retry-After", "5");
  return res.type("html").send(renderErrorPage(status));
}

function previewError(req, res, next) {
  if (!Object.hasOwn(errorPages, req.params.code)) return next();
  return sendErrorPage(res, Number(req.params.code));
}

function handlePageError(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number(error.statusCode || error.status);
  const code = status >= 400 && status <= 599 ? status : 500;
  if (code >= 500)
    console.error("[MCL] Request failed:", error.code || "internal error");
  if (
    req.path === "/api" ||
    req.path.startsWith("/api/") ||
    !req.accepts("html")
  ) {
    return res
      .status(code)
      .set("Cache-Control", "no-store")
      .json({ error: "Не удалось выполнить запрос. Попробуйте ещё раз." });
  }
  if (Object.hasOwn(errorPages, code)) return sendErrorPage(res, code);
  return res
    .status(code)
    .type("text")
    .send(
      "Не удалось выполнить запрос. Проверьте запрос и попробуйте ещё раз.",
    );
}

module.exports = { sendErrorPage, previewError, handlePageError };
