import { createJsonStore } from "./json-store.js";
import { createMongoStore } from "./mongo-store.js";

export async function createStore(config) {
  if (config.mongoUri) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    const store = await createMongoStore(client, config.mongoDbName);
    console.log(`[hireloop] using MongoDB database "${config.mongoDbName}"`);
    return store;
  }

  const store = await createJsonStore(config.devStorePath);
  console.warn(
    `[hireloop] MONGODB_URI not set - using local JSON store at ${config.devStorePath}`
  );
  return store;
}
