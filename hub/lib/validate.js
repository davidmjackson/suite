// lib/validate.js — zod request-body validation middleware.
// validate(schema, { source, onInvalid }) -> Express middleware.
// On success: req.body is replaced with zod's parsed (coerced, unknown-key-stripped) output.
// On failure: if onInvalid(req, res, error) is given it is called (form routes re-render);
//   otherwise next(err) with err.status=400 and err.fields = flattened field errors (JSON routes).
export function validate(schema, { source = "body", onInvalid } = {}) {
  return function validateMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (result.success) {
      req[source] = result.data;
      return next();
    }
    if (onInvalid) return onInvalid(req, res, result.error);
    const err = new Error("validation_failed");
    err.status = 400;
    err.fields = result.error.flatten().fieldErrors;
    return next(err);
  };
}
