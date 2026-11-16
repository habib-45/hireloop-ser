import "dotenv/config";

import { createApp } from "./src/app.js";
import { config } from "./src/config.js";
import { DEMO_ACCOUNTS, seedStore } from "./src/data/seed.js";
import { createStore } from "./src/store/index.js";

async function main() {
  const store = await createStore(config);
  const seeded = await seedStore(store, config);

  console.log(
    `[hireloop] seed ready: ${seeded.companies} companies, ${seeded.jobs} base jobs`
  );

  if (seeded.demo) {
    console.log(
      `[hireloop] demo data ready: ${seeded.demo.users} accounts (password: ${DEMO_ACCOUNTS.password})`
    );
    console.log(
      `[hireloop] demo logins: ${DEMO_ACCOUNTS.seeker}, ${DEMO_ACCOUNTS.recruiter}, ${DEMO_ACCOUNTS.admin}`
    );
  }

  const app = createApp({ store, config });

  const server = app.listen(config.port, () => {
    console.log(`[hireloop] API listening on http://localhost:${config.port}`);
    console.log(
      `[hireloop] allowed origins: ${config.clientOrigins.join(", ")}`
    );
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`\n[hireloop] ${signal} received - shutting down...`);

    server.close(async () => {
      await store.close?.();
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[hireloop] failed to start:", error);
  process.exit(1);
});
