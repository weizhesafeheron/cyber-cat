/**
 * 猫的档案。养过的所有猫在这里留档（CONTEXT.md 的「猫的档案」）。
 *
 * 平台无关的纯逻辑：入档判定、去重、编解码。落盘由 app/farewell.ts 经注入端口做。
 * 为什么独立于 world.json 见 [ADR 0010](../../docs/adr/0010-memorial-archive-separate-save.md)。
 */
export * from './types.js';
export * from './constants.js';
export {
  emptyMemorial,
  enshrine,
  entryOf,
  latestEntry,
  lifespanDays,
  sameCat,
} from './archive.js';
export { MemorialSaveError, parseMemorial, serializeMemorial } from './save.js';
