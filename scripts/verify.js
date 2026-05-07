const { spawnSync } = require("node:child_process");

const files = [
  "app.js",
  "api/index.js",
  "lib/supabase.js",
  "lib/mappers.js",
  "routes/auth.js",
  "routes/orders.js",
  "routes/products.js",
  "routes/transactions.js",
  "routes/wishlist.js",
  "scripts/seed.js",
  "public/js/app.js"
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    process.stderr.write(`Syntax check failed for ${file}\n`);
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    process.stderr.write(result.stderr || result.stdout || "No diagnostic output returned.\n");
    process.exit(result.status || 1);
  }
}

console.log(`Verified ${files.length} JavaScript files.`);
