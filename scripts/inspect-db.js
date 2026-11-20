const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('flo.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log('Tables count:', tables.length);

const schema = {};
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  const fks = db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all();
  const idxs = db.prepare(`PRAGMA index_list("${t.name}")`).all();
  schema[t.name] = {
    columns: cols,
    foreign_keys: fks,
    indexes: idxs
  };
}

fs.writeFileSync('scripts/flo-schema.json', JSON.stringify(schema, null, 2));
console.log('Schema saved to scripts/flo-schema.json');
