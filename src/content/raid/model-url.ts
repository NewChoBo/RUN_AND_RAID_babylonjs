declare const __RAID_MODEL_VERSIONS__: Record<string, string>;

export function raidModelUrl(path: string) {
  const revision = __RAID_MODEL_VERSIONS__[path];
  return revision ? path + '?v=' + revision : path;
}
