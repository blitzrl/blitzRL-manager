import { getDB, mutate } from './storage.js';

export function logChange(action, entity, entityId, summary, snapshot = null){
  mutate(db => {
    db.history.unshift({
      ts: new Date().toISOString(),
      action, entity, entityId, summary,
      snapshot: snapshot ? JSON.stringify(snapshot).slice(0, 500) : null
    });
    if(db.history.length > 500) db.history.length = 500;
  });
}

export function listHistory(limit = 50){
  return getDB().history.slice(0, limit);
}