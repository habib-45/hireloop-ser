import { HttpError } from "../lib/http-error.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found." },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    });
  }

  const status = error instanceof HttpError ? error.status : 500;

  if (status >= 500) {
    console.error("[hireloop] unhandled error:", error);
  }

  const expose = error instanceof HttpError ? error.expose : false;

  res.status(status).json({
    error: {
      code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
      message: expose
        ? error.message
        : "Something went wrong. Please try again.",
      ...(error instanceof HttpError && error.field
        ? { field: error.field }
        : {}),
    },
  });
}
