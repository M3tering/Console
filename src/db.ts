import { Level } from "level";

export const db = new Level("./db", { valueEncoding: "json" });
