import { parseSpec, type SpecDoc } from './parse';

/*
 * 스펙 묶음 (F-IN-03·08): 앱 버전 하나의 스펙 폴더 전체 스냅샷. 폴더·ZIP에서 읽은 파일 목록을 받아
 * `<스펙 이름>/spec.md`만 입력으로 쓴다 (폴더 이름 = 스펙 이름). 같은 폴더의 plan·tasks·research 등은 무시한다.
 */

export type BundleFile = { path: string; content: string };

export type SpecBundle = {
  specs: SpecDoc[];
  /** 스펙 이름별 경고 */
  warnings: Record<string, string[]>;
  /** 입력으로 쓰지 않은 파일 수 */
  ignored: number;
};

export function readBundle(files: BundleFile[]): SpecBundle {
  const specs: SpecDoc[] = [];
  const warnings: Record<string, string[]> = {};
  let ignored = 0;
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = parts.at(-2);
    if (parts.at(-1) !== 'spec.md' || !name) {
      ignored++;
      continue;
    }
    if (specs.some((s) => s.name === name)) {
      (warnings[name] ??= []).push(`${f.path}: 같은 이름의 스펙 폴더가 또 있다 (앞의 것을 쓴다)`);
      continue;
    }
    const r = parseSpec(name, f.content);
    specs.push(r.spec);
    if (r.warnings.length) warnings[name] = r.warnings;
  }
  return { specs, warnings, ignored };
}
