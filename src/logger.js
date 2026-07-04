function timestamp() {
  return new Date().toISOString();
}

function log(level, message, meta) {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${timestamp()}] [${level}] ${message}${suffix}`);
}

module.exports = {
  info: (message, meta) => log("INFO", message, meta),
  warn: (message, meta) => log("WARN", message, meta),
  error: (message, meta) => log("ERROR", message, meta)
};
