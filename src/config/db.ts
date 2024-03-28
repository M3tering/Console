import { Level } from "level";

export const db = new Level("src/db", { valueEncoding: "json" });
