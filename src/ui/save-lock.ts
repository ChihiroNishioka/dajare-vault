/** 保存の二度押しを一度にする。2回目は false。 */
export function tryBeginSave(lock: { held: boolean }): boolean {
  if (lock.held) return false;
  lock.held = true;
  return true;
}

export function endSave(lock: { held: boolean }): void {
  lock.held = false;
}
