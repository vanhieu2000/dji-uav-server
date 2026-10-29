const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  os = require("os"),
  path = require("path");
test("native settings persist privately, apply only after restart, and reject invalid configuration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uav-config-")),
    names = [
      "UAV_OPERATOR_CONFIG_FILE",
      "MEDIA_DIR",
      "VISION_ENDPOINT",
      "VISION_ENABLED",
      "VISION_WEBHOOK_SECRET",
      "VISION_API_TOKEN",
    ],
    previous = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    for (const k of names) delete process.env[k];
    process.env.UAV_OPERATOR_CONFIG_FILE = path.join(dir, "operator.json");
    const c = require("../src/services/operatorConfig");
    assert.throws(() => c.save({ MEDIA_DIR: "relative/folder" }));
    assert.throws(() => c.save({ VISION_ENDPOINT: "file:///etc/passwd" }));
    assert.throws(() => c.save({ VISION_ENABLED: "true" }));
    const folder = path.join(dir, "photos");
    c.save({
      MEDIA_DIR: folder,
      VISION_ENDPOINT: "http://127.0.0.1:5000/analyze",
      VISION_WEBHOOK_SECRET: "test-secret-with-32-characters!!!",
      VISION_ENABLED: "true",
    });
    assert.equal(process.env.MEDIA_DIR, undefined);
    assert.equal(c.status().restart_required, true);
    assert.equal(c.read().VISION_WEBHOOK_SECRET, undefined);
    assert.ok(!JSON.stringify(c.status()).includes("test-secret-with"));
    assert.equal(
      fs.statSync(process.env.UAV_OPERATOR_CONFIG_FILE).mode & 0o777,
      0o600,
    );
    c.apply();
    assert.equal(process.env.MEDIA_DIR, folder);
    assert.equal(c.status().restart_required, false);
    assert.equal(c.status().vision.credentials_configured, true);
    c.save({ VISION_ENABLED: "false" });
    c.apply();
    assert.equal(process.env.VISION_ENABLED, "false");
  } finally {
    for (const k of names)
      if (previous[k] === undefined) delete process.env[k];
      else process.env[k] = previous[k];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
