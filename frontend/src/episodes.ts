import type { Episode } from './types';

/**
 * Phân tích & gom nhóm tập phim "thông minh".
 *
 * Nguồn phim thường trả 1 danh sách phẳng, trộn nhiều bản:
 *   "Tập 1 (Vietsub #1)", "Tập 1 (Thuyết minh #1)", "Full (Lồng tiếng)", "Tập 12 - END"...
 * Ở đây tách thành từng bản (Vietsub / Thuyết minh / Lồng tiếng / ...), sắp đúng thứ tự số tập,
 * bỏ tập trùng, và hỗ trợ lọc kiểu "5", "10-20", "tập cuối".
 */

export type VersionKind = 'vietsub' | 'thuyetminh' | 'longtieng' | 'engsub' | 'raw' | 'other';

export interface ParsedEpisode {
  ep: Episode;
  /** Vị trí trong danh sách gốc. */
  index: number;
  /** Số tập (vd 12, 12.5), null nếu là "Full", "Trailer", "Đặc biệt"... */
  number: number | null;
  /** Nhãn ngắn để hiển thị trên nút: "Tập 12", "Full", "Tập 12 · END". */
  shortLabel: string;
  versionKey: string;
}

export interface EpisodeGroup {
  key: string;
  kind: VersionKind;
  /** "Vietsub", "Thuyết minh", "Vietsub · Server 2"... */
  label: string;
  episodes: ParsedEpisode[];
}

const KIND_ORDER: VersionKind[] = ['vietsub', 'thuyetminh', 'longtieng', 'engsub', 'raw', 'other'];
const KIND_LABEL: Record<VersionKind, string> = {
  vietsub: 'Vietsub',
  thuyetminh: 'Thuyết minh',
  longtieng: 'Lồng tiếng',
  engsub: 'Engsub',
  raw: 'Raw',
  other: 'Bản khác',
};

/** Bỏ dấu tiếng Việt + chữ thường để so khớp. */
export function plainText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function detectKind(text: string): VersionKind {
  const t = plainText(text);
  if (/thuyet\s*minh|\btm\b/.test(t)) return 'thuyetminh';
  if (/long\s*tieng|\blt\b|dub/.test(t)) return 'longtieng';
  if (/eng\s*sub|english/.test(t)) return 'engsub';
  if (/viet\s*sub|phu\s*de|\bvs\b|sub\s*viet/.test(t)) return 'vietsub';
  if (/\braw\b/.test(t)) return 'raw';
  return 'other';
}

/** Tách "Tập 1 (Vietsub #1)" -> { base: "Tập 1", version: "Vietsub #1" }. */
function splitLabel(name: string): { base: string; version: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  if (m && m[1].trim()) return { base: m[1].trim(), version: m[2].trim() };
  return { base: name.trim(), version: '' };
}

function parseNumber(base: string): number | null {
  const t = plainText(base);
  if (/^(full|tron bo|tap full)$/.test(t)) return null;
  const m = /(?:tap|ep|episode|#)?\s*(\d+(?:[.,]\d+)?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function makeShortLabel(base: string, num: number | null): string {
  if (num === null) {
    const t = plainText(base);
    return t === '' || t === 'full' ? 'Full' : base;
  }
  const extra = /\b(end|cuoi|hoan tat|final)\b/.test(plainText(base)) ? ' · END' : '';
  return `Tập ${num}${extra}`;
}

/** Gom danh sách tập thành các bản (Vietsub / Thuyết minh / ...), mỗi bản đã sắp thứ tự & bỏ trùng. */
export function groupEpisodes(episodes: Episode[]): EpisodeGroup[] {
  const groups = new Map<string, EpisodeGroup>();
  const serverCountByKind = new Map<VersionKind, Set<string>>();

  const parsed = episodes.map((ep, index) => {
    const { base, version } = splitLabel(ep.name);
    const kind = version ? detectKind(version) : detectKind(base);
    const server = /#\s*(\d+)/.exec(version)?.[1] ?? '1';
    const versionKey = version ? `${kind}-${server}` : 'default';
    if (version) {
      if (!serverCountByKind.has(kind)) serverCountByKind.set(kind, new Set());
      serverCountByKind.get(kind)!.add(server);
    }
    const number = parseNumber(base);
    return {
      parsed: { ep, index, number, shortLabel: makeShortLabel(base, number), versionKey } as ParsedEpisode,
      kind: version ? kind : ('other' as VersionKind),
      server,
      hasVersion: Boolean(version),
    };
  });

  for (const { parsed: p, kind, server, hasVersion } of parsed) {
    let g = groups.get(p.versionKey);
    if (!g) {
      const multiServer = (serverCountByKind.get(kind)?.size ?? 0) > 1;
      const label = !hasVersion
        ? 'Danh sách tập'
        : `${KIND_LABEL[kind]}${multiServer ? ` · Server ${server}` : ''}`;
      g = { key: p.versionKey, kind: hasVersion ? kind : 'other', label, episodes: [] };
      groups.set(p.versionKey, g);
    }
    g.episodes.push(p);
  }

  for (const g of groups.values()) {
    // Sắp theo số tập (tập không có số để cuối, giữ thứ tự gốc), rồi bỏ tập trùng số
    g.episodes.sort((a, b) => {
      if (a.number === null && b.number === null) return a.index - b.index;
      if (a.number === null) return 1;
      if (b.number === null) return -1;
      return a.number - b.number || a.index - b.index;
    });
    const seen = new Set<string>();
    g.episodes = g.episodes.filter((p) => {
      const k = p.number === null ? `x:${p.ep.url}` : `n:${p.number}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === 'default') return -1;
    if (b.key === 'default') return 1;
    return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key);
  });
}

/** Bản đang chứa tập đang phát (để mở đúng tab), không có thì bản đầu tiên. */
export function groupOfUrl(groups: EpisodeGroup[], url?: string): EpisodeGroup | undefined {
  if (url) {
    const found = groups.find((g) => g.episodes.some((p) => p.ep.url === url));
    if (found) return found;
  }
  return groups[0];
}

/** Tập tiếp theo trong CÙNG bản (xem hết tập 22 Vietsub thì sang 23 Vietsub, không nhảy sang Thuyết minh). */
export function nextEpisode(episodes: Episode[], currentUrl?: string): Episode | null {
  if (!currentUrl) return null;
  const groups = groupEpisodes(episodes);
  for (const g of groups) {
    const i = g.episodes.findIndex((p) => p.ep.url === currentUrl);
    if (i >= 0) return g.episodes[i + 1]?.ep ?? null;
  }
  return null;
}

/**
 * Lọc tập thông minh:
 *  - "5" / "tập 5"  -> đúng tập 5 (nếu không có thì các tập bắt đầu bằng 5)
 *  - "10-20", "10 đến 20" -> khoảng tập
 *  - "cuối", "mới nhất", "last" -> tập cuối
 *  - "đầu" -> tập đầu
 *  - chữ khác -> tìm trong tên tập (không dấu)
 */
export function filterEpisodes(list: ParsedEpisode[], rawQuery: string): ParsedEpisode[] {
  const q = plainText(rawQuery);
  if (!q) return list;

  if (/^(cuoi|tap cuoi|moi nhat|last|end|newest)$/.test(q)) return list.slice(-1);
  if (/^(dau|tap dau|first)$/.test(q)) return list.slice(0, 1);

  const range = /^(?:tap\s*)?(\d+)\s*(?:-|–|den|toi|->|~)\s*(\d+)$/.exec(q);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return list.filter((p) => p.number !== null && p.number >= lo && p.number <= hi);
  }

  const single = /^(?:tap|ep|#)?\s*(\d+)$/.exec(q);
  if (single) {
    const n = Number(single[1]);
    const exact = list.filter((p) => p.number === n);
    if (exact.length) return exact;
    return list.filter((p) => p.number !== null && String(p.number).startsWith(single[1]));
  }

  return list.filter((p) => plainText(p.ep.name).includes(q) || plainText(p.shortLabel).includes(q));
}
