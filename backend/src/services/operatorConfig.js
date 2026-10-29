/** Native private configuration overlay. Changes apply after restart; public status excludes secrets. */
const fs = require("fs"),
  path = require("path");
const { ValidationError } = require("../utils/validate");
const file = () =>
  process.env.UAV_OPERATOR_CONFIG_FILE ||
  path.resolve(__dirname, "../../data/operator-config.json");
const keys = [
  "MEDIA_DIR",
  "VISION_ENDPOINT",
  "VISION_PUBLIC_BASE_URL",
  "VISION_ENABLED",
];
const secrets = ["VISION_API_TOKEN", "VISION_WEBHOOK_SECRET"];
function stored() {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
function serviceUrl(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol !== "http:") return false;
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
      (process.env.NODE_ENV !== "production" &&
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname))
    );
  } catch {
    return false;
  }
}
function read() {
  try {
    const r = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Object.fromEntries(
      keys.filter((k) => typeof r[k] === "string").map((k) => [k, r[k]]),
    );
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
function apply() {
  const r = stored();
  for (const k of [...keys, ...secrets]) if (r[k]) process.env[k] = r[k];
}
function save(body) {
  const r = stored();
  for (const [k, v] of Object.entries(body)) {
    if (
      ![...keys, ...secrets].includes(k) ||
      typeof v !== "string" ||
      !v.trim() ||
      v.length > 2048
    )
      throw new ValidationError("Cấu hình không hợp lệ");
    const value = v.trim();
    if (secrets.includes(k)) {
      if (value.length < 16)
        throw new ValidationError("Khóa xác thực cần ít nhất 16 ký tự");
      r[k] = value;
    } else if (k === "VISION_ENABLED") {
      if (!["true", "false"].includes(value))
        throw new ValidationError("VISION_ENABLED cần true/false");
      r[k] = value;
    } else if (k === "MEDIA_DIR") {
      if (!path.isAbsolute(value))
        throw new ValidationError(
          "Nhập đường dẫn tuyệt đối trên máy chủ (ví dụ D:/UAV/AnhGoc)",
        );
      fs.mkdirSync(value, { recursive: true });
      fs.accessSync(value, fs.constants.W_OK);
      r[k] = path.resolve(value);
    } else {
      if (!serviceUrl(value))
        throw new ValidationError(
          "URL cần HTTPS hoặc địa chỉ HTTP local/LAN trong chế độ local",
        );
      r[k] = new URL(value).href;
    }
  }
  if (
    r.VISION_ENABLED === "true" &&
    !(r.VISION_WEBHOOK_SECRET || process.env.VISION_WEBHOOK_SECRET)
  )
    throw new ValidationError(
      "Cần khóa xác thực callback trước khi bật Vision",
    );
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  const tmp = file() + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  return r;
}
function status() {
  const saved = read();
  return {
    active: Object.fromEntries(
      keys.map((k) => [
        k,
        process.env[k] ||
          (k === "MEDIA_DIR"
            ? path.resolve(__dirname, "../../uploads/media")
            : null),
      ]),
    ),
    saved,
    restart_required: [...keys, ...secrets].some(
      (k) => stored()[k] && stored()[k] !== process.env[k],
    ),
    vision: {
      enabled: process.env.VISION_ENABLED === "true",
      credentials_configured: !!process.env.VISION_WEBHOOK_SECRET,
      secret_saved: !!stored().VISION_WEBHOOK_SECRET,
      api_token_saved: !!stored().VISION_API_TOKEN,
      public_base_configured: !!process.env.VISION_PUBLIC_BASE_URL,
    },
  };
}
module.exports = { read, apply, save, status, serviceUrl };
