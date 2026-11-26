import type { Preferences, Source } from "./model.ts";

export function folderPath(source: Source): string[] {
  return source.folderPath ?? (typeof source.folder === "string" && source.folder ? [source.folder] : []);
}

/** Parse a user-entered folder string ("技术 / Rust") into a normalized path. */
export function parseFolderPath(input: string): string[] {
  return input
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 32)
    .map((part) => part.slice(0, 120));
}

export function orderSources(sources: Source[], preferences: Preferences, locale: string) {
  const active = sources.filter((source) => !source.archived);
  if (preferences.sortFeedsByName === true) {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    return active.sort((left, right) => collator.compare(left.name, right.name));
  }
  const order = Array.isArray(preferences.feedOrder) ? preferences.feedOrder : [];
  const ranks = new Map(order.map((id, index) => [id, index]));
  return active.sort((left, right) =>
    (ranks.get(left.id) ?? order.length) - (ranks.get(right.id) ?? order.length),
  );
}

type Group = { name: string; sources: Source[]; groups: Map<string, Group> };

export function groupSources(sources: Source[]) {
  const root: Group = { name: "", sources: [], groups: new Map() };
  for (const source of sources) {
    let group = root;
    for (const name of folderPath(source)) {
      let child = group.groups.get(name);
      if (!child) {
        child = { name, sources: [], groups: new Map() };
        group.groups.set(name, child);
      }
      group = child;
    }
    group.sources.push(source);
  }
  return root;
}

export function availableFolders(sources: Source[]) {
  const folders = new Map<string, string[]>();
  for (const source of sources) {
    const path = folderPath(source);
    for (let depth = 1; depth <= path.length; depth++) {
      const parent = path.slice(0, depth);
      folders.set(JSON.stringify(parent), parent);
    }
  }
  return folders;
}

export function canReorderSource(sources: Source[], id: string, direction: -1 | 1) {
  const index = sources.findIndex((source) => source.id === id);
  if (index < 0) return false;
  const group = JSON.stringify(folderPath(sources[index]));
  let sibling = index + direction;
  while (sibling >= 0 && sibling < sources.length &&
    JSON.stringify(folderPath(sources[sibling])) !== group) sibling += direction;
  return sibling >= 0 && sibling < sources.length;
}

export function reorderedSourceIds(sources: Source[], id: string, direction: -1 | 1) {
  const index = sources.findIndex((source) => source.id === id);
  if (index < 0) return;
  const group = JSON.stringify(folderPath(sources[index]));
  let sibling = index + direction;
  while (sibling >= 0 && sibling < sources.length &&
    JSON.stringify(folderPath(sources[sibling])) !== group) sibling += direction;
  if (sibling < 0 || sibling >= sources.length) return;
  const ids = sources.map((source) => source.id);
  [ids[index], ids[sibling]] = [ids[sibling], ids[index]];
  return ids;
}
