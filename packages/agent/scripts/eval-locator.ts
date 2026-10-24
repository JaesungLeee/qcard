/**
 * 검증 포인트 판정 평가: 실기기에서 저장한 관찰(트리 텍스트)로 verifyPoints를 다시 돌려 정답과 비교한다.
 * 디바이스 없이 판정 규칙(요소 찾기 프롬프트·코드 비교)만 바꿔 가며 확인한다. 실제 모델을 부른다 (1회 몇 센트).
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @qcard/agent eval-locator [--only TC-ONBOARDING-020]
 *
 * 평가 세트는 실기기 관찰이라 저장소 밖에 둔다: ../qcard-specs/eval/locator/set.json · obs/<TC>/obs-NN.txt
 * (QCARD_EVAL_DIR로 바꿀 수 있다). 대상 앱은 qcard.local.json의 devApp
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatTree, type DeviceDriver, type UiElement } from '@qcard/device';
import { requireDevApp } from '@qcard/device/node';
import { createLlm, UsageMeter } from '@qcard/llm';
import type { PointResult, VerificationPoint } from '@qcard/shared';
import { outsideAppTree, verifyPoints, type Observation } from '../src';

const APP = requireDevApp();

type Item = {
  tc: string;
  /** 관찰 파일 (시간순, 마지막이 검증 시점 화면) */
  obs: string[];
  point: VerificationPoint;
  /** 정답으로 인정하는 결과 */
  accept: PointResult['result'][];
  /** 왜 이 정답인지 */
  why: string;
};

const root = process.env.QCARD_EVAL_DIR ?? resolve(import.meta.dirname, '../../../../qcard-specs/eval/locator');
const { values } = parseArgs({ options: { only: { type: 'string' } } });
const items = (JSON.parse(await readFile(join(root, 'set.json'), 'utf8')) as Item[]).filter(
  (x) => !values.only || x.tc === values.only,
);

/** formatTree 한 줄 → 요소 (LLM에 보낸 텍스트에서 되살린다) */
function parseLine(line: string, depth = 0): UiElement | undefined {
  const head = /^(e\d+) (\S+)/.exec(line);
  if (!head) return undefined;
  let rest = line.slice(head[0].length);
  const el: UiElement = {
    ref: head[1]!,
    cls: head[2]!,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    clickable: false,
    enabled: true,
    focused: false,
    scrollable: false,
    password: false,
    depth,
  };
  const str = () => {
    // JSON 문자열 하나를 읽는다
    let i = 1;
    while (i < rest.length && !(rest[i] === '"' && rest[i - 1] !== '\\')) i++;
    const v = JSON.parse(rest.slice(0, i + 1)) as string;
    rest = rest.slice(i + 1);
    return v;
  };
  while ((rest = rest.trimStart())) {
    if (rest.startsWith('"')) el.text = str();
    else if (rest.startsWith('desc="')) ((rest = rest.slice(5)), (el.desc = str()));
    else if (rest.startsWith('label="')) ((rest = rest.slice(6)), str());
    else {
      const b = /^\[(-?\d+),(-?\d+) (\d+)x(\d+)\]/.exec(rest);
      const tok = b ? b[0] : rest.split(' ')[0]!;
      if (b) el.bounds = { x: +b[1]!, y: +b[2]!, w: +b[3]!, h: +b[4]! };
      else if (tok.startsWith('id=')) el.resourceId = tok.slice(3);
      else if (tok === 'clickable') el.clickable = true;
      else if (tok === 'scrollable') el.scrollable = true;
      else if (tok === 'disabled') el.enabled = false;
      else if (tok === 'focused') el.focused = true;
      else if (tok === 'checked' || tok === 'unchecked') el.checked = tok === 'checked';
      rest = rest.slice(tok.length);
    }
  }
  return el;
}

async function observation(tc: string, file: string): Promise<Observation> {
  const raw = await readFile(join(root, 'obs', tc, file), 'utf8');
  const i = raw.indexOf('\n');
  // 첫 줄은 포그라운드 앱 (# fg=…), 나머지는 트리
  const fg = raw.slice(0, i).replace(/^# fg=/, '');
  const treeText = raw.slice(i + 1).trimEnd();
  const parsed = treeText
    .split('\n')
    .map((l) => parseLine(l))
    .filter((e): e is UiElement => Boolean(e));
  // 실제 실행과 같은 가드: 앱 밖 화면은 "앱 밖" 요소 하나로
  const outside = outsideAppTree(APP, fg || undefined, parsed);
  return {
    index: Number(/obs-(\d+)/.exec(file)![1]),
    tree: outside ?? parsed,
    treeText: outside ? formatTree(outside) : treeText,
    png: new Uint8Array(),
    foreground: fg || undefined,
    keyboard: { shown: false },
    screenshot: { kind: 'url', url: file },
  };
}

const device = { info: async () => ({ density: 450 }) } as unknown as DeviceDriver;
const meter = new UsageMeter();
const llm = createLlm({ mode: 'live', cassetteDir: '', meter });

let ok = 0;
const fails: string[] = [];
// 실제 실행처럼 케이스(같은 관찰)마다 포인트를 한 번에 판정한다
const groups = new Map<string, Item[]>();
for (const x of items)
  groups.set(`${x.tc}|${x.obs.join(',')}`, [...(groups.get(`${x.tc}|${x.obs.join(',')}`) ?? []), x]);
for (const [key, group] of groups) {
  const [tc, obsList] = key.split('|') as [string, string];
  const evidence = await Promise.all(obsList.split(',').map((f) => observation(tc, f)));
  const results = await verifyPoints(
    { device, llm, appPackage: APP, vision: false },
    { caseId: tc, points: group.map((x) => x.point), evidence },
  );
  results.forEach((r, i) => {
    const x = group[i]!;
    const pass = x.accept.includes(r.result);
    if (pass) ok++;
    else
      fails.push(
        `${x.tc} ${x.point.id} [${x.point.compare}] ${x.point.expected}\n    정답 ${x.accept.join('|')} / 결과 ${r.result}: ${r.reason}\n    (${x.why})`,
      );
    console.log(
      `${pass ? '✓' : '✗'} ${x.tc} ${x.point.id} ${x.point.compare} → ${r.result}${pass ? '' : ` (정답 ${x.accept.join('|')})`}`,
    );
  });
}
console.log(`\n정답 ${ok}/${items.length} · 호출 ${meter.run.calls} · $${meter.run.costUsd.toFixed(3)}`);
if (fails.length) console.log(`\n틀린 것:\n${fails.join('\n')}`);
process.exitCode = fails.length ? 1 : 0;
