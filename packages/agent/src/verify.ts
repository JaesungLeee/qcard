import { findElement, pxToDp, type UiElement } from '@qcard/device';
import { cachedSystem, MODELS, outputFormat, parseOutput } from '@qcard/llm';
import { LocateBatchOutput, VerifyBatchOutput, type PointResult, type VerificationPoint } from '@qcard/shared';
import { clockOf, observationBlocks, observe, type AgentEnv, type Observation } from './env';

/*
 * 검증 포인트 판정. 트리 포인트는 LLM이 대상 요소만 찾고 비교는 코드가 한다.
 * 비전 포인트는 Verifier가 판정한다. 포인트 종류별로 한 번씩만 호출한다.
 */

export const LOCATOR_SYSTEM = `너는 Android 앱 QA의 검증 보조다. 검증 포인트마다 판정 근거가 될 요소를 접근성 트리에서 찾아 그 번호(e12)를 돌려준다. 판정은 하지 않는다.

관찰은 마지막 단계를 수행하며 본 화면들이고, 번호가 클수록 나중이다. 요소 참조에는 관찰 번호가 붙어 있다(o7.e6 = 관찰 7의 e6). element_ref에는 그 참조를 그대로 쓴다.

비교 종류별로 찾을 요소:
- visible·text_exists·count·size_dp: 대상 요소. 토스트처럼 잠깐 뜨는 요소가 있으므로 어느 관찰에서든 찾는다
- not_visible: 마지막 관찰에서만 본다. 대상이 있으면 그 요소
- screen: 마지막 관찰에서만 본다. 그 화면임을 보여 주는 요소(제목·고유 버튼 등)
- state: 마지막 관찰에서만 본다. 그 앱 상태를 보여 주는 요소

status: found(찾음) · absent(화면에 분명히 없음) · unclear(화면만으로는 알 수 없음).
대상이 화면에 나타나는 종류가 아니어서 판단할 수 없으면 absent가 아니라 unclear다.

unclear로 답해야 하는 경우 (잘못 쓰인 포인트가 섞여 온다):
- 대상이 화면 요소가 아니라 동작·결과·내부 상태다: "이동한다", "버린다", "기록된다", "되돌아가지 않는다", "다시 확보하지 않는다", 문장 조각("방을 만들지 않")
- not_visible인데 기대 문장이 "보이면 안 되는 요소"가 아니라 일어나야 할 결과를 말한다 (예: "튜토리얼로 이동한다", "앱을 백그라운드로 보낸다", "처음부터 다시 거친다")
not_visible의 found는 보이면 안 되는 바로 그 요소가 화면에 있을 때만이다. 기대한 결과 화면의 요소(이동해 간 화면의 제목, 런처 화면 등)를 고르지 않는다.
비슷하지만 다른 요소를 고르지 않는다. 모든 포인트에 답한다.`;

export const VERIFIER_SYSTEM = `너는 Android 앱 QA Verifier다. 화면(스크린샷과 접근성 트리)을 보고 검증 포인트마다 기대 결과와 일치하는지 판정한다.

- match: 기대대로 보인다. mismatch: 기대와 다르다. unknown: 화면만으로 판단할 수 없다.
- observed에는 실제로 본 것을, reason에는 판정 근거를 쓴다. 근거 요소가 트리에 있으면 target_element에 번호를 쓴다.
- 추측으로 match를 주지 않는다. 모든 포인트에 답한다.`;

const EARLIER_NOTE =
  '\n\n앞선 화면은 마지막 단계를 수행하며 본 화면이다. visible·text_exists·count는 토스트처럼 잠깐 뜨는 요소가 있으므로 어느 화면에서든 보이면 match다. 그 밖의 비교는 검증 시점 화면으로 판정한다.';

const pointList = (points: VerificationPoint[]) =>
  points.map((p) => `- ${p.id} · 대상: ${p.target} · 비교: ${p.compare} · 기대: ${p.expected}`).join('\n');

const describe = (e: UiElement) =>
  [e.resourceId && `id=${e.resourceId}`, e.text && `"${e.text}"`, e.desc && `desc="${e.desc}"`]
    .filter(Boolean)
    .join(' ') || e.ref;

/** 결과에 남길 요소 이름: resource-id가 없으면(testTag 미노출 앱) 글자·설명 */
const elementName = (e: UiElement) => e.resourceId ?? (e.text ? `"${e.text}"` : e.desc ? `desc="${e.desc}"` : e.ref);

/** 기대값 문장에서 따옴표·백틱으로 감싼 텍스트 */
const quoted = (s: string) => s.match(/[`"“'‘]([^`"”'’]+)[`"”'’]/)?.[1];

/**
 * 찾은 요소와 같은 종류의 요소들: resource-id가 있으면 같은 id, 없으면 같은 부모 아래 같은 클래스·크기.
 * 목록 항목·인디케이터 dot처럼 같은 모양이 반복되는 요소를 센다
 */
function sameKind(tree: UiElement[], el: UiElement) {
  if (el.resourceId) return tree.filter((e) => e.resourceId === el.resourceId);
  return tree.filter(
    (e) => e.parent === el.parent && e.cls === el.cls && e.bounds.w === el.bounds.w && e.bounds.h === el.bounds.h,
  );
}

/** 찾은 요소로 포인트를 판정한다 (코드 비교). tree: 요소를 찾은 관찰의 트리 (count에 쓴다) */
export function compareTree(
  p: VerificationPoint,
  el: UiElement | undefined,
  density: number,
  tree: UiElement[] = el ? [el] : [],
): Pick<PointResult, 'result' | 'observed' | 'reason'> {
  const found = el ? `찾은 요소: ${describe(el)}` : '대상 요소 없음';
  switch (p.compare) {
    case 'visible':
    case 'screen':
      return {
        result: el ? 'match' : 'mismatch',
        observed: found,
        reason: el ? '요소가 화면에 있다' : '요소를 찾지 못했다',
      };
    case 'not_visible':
      return {
        result: el ? 'mismatch' : 'match',
        observed: found,
        reason: el ? '보이면 안 되는 요소가 있다' : '요소가 없다',
      };
    case 'state': {
      // 요소가 있다는 것만으로는 상태가 기대와 같은지 알 수 없다 — 기대 텍스트가 적혀 있을 때만 비교한다
      const want = el && quoted(p.expected);
      if (!el || !want) {
        return {
          result: 'unknown',
          observed: found,
          reason: el
            ? '상태를 보여 주는 요소는 있으나 기대 상태와 비교할 값이 없다'
            : '화면으로 앱 상태를 확인할 수 없다',
        };
      }
      const has = `${el.text ?? ''} ${el.desc ?? ''}`.includes(want);
      return { result: has ? 'match' : 'mismatch', observed: found, reason: has ? `"${want}" 포함` : `"${want}" 없음` };
    }
    case 'text_exists': {
      if (!el) return { result: 'mismatch', observed: found, reason: '요소를 찾지 못했다' };
      const want = quoted(p.expected);
      if (!want) return { result: 'match', observed: found, reason: '요소가 있다 (기대 텍스트가 따로 적혀 있지 않음)' };
      const has = `${el.text ?? ''} ${el.desc ?? ''}`.includes(want);
      return { result: has ? 'match' : 'mismatch', observed: found, reason: has ? `"${want}" 포함` : `"${want}" 없음` };
    }
    case 'size_dp': {
      if (!el) return { result: 'mismatch', observed: found, reason: '요소를 찾지 못했다' };
      const want = Number(p.expected.match(/(\d+(?:\.\d+)?)\s*dp/)?.[1]);
      const w = pxToDp(el.bounds.w, density);
      const h = pxToDp(el.bounds.h, density);
      const observed = `${found} · ${w.toFixed(1)}×${h.toFixed(1)}dp`;
      if (!want) return { result: 'unknown', observed, reason: '기대 크기(dp)를 읽지 못했다' };
      const okSize = Math.min(w, h) >= want;
      return { result: okSize ? 'match' : 'mismatch', observed, reason: `최소 ${want}dp ${okSize ? '이상' : '미만'}` };
    }
    case 'count': {
      const want = Number(p.expected.match(/\d+/)?.[0]);
      const n = el ? sameKind(tree, el).length : 0;
      const observed = `${found} · ${n}개`;
      if (Number.isNaN(want)) return { result: 'unknown', observed, reason: '기대 개수를 읽지 못했다' };
      // 그림으로만 그린 요소(선택된 인디케이터 dot 등)는 트리에 노드가 없다 — 적게 센 것은 불일치의 근거가 못 된다
      if (n < want) {
        return {
          result: 'unknown',
          observed,
          reason: `기대 ${want}개, 트리에서 ${n}개 (트리에 없는 요소가 있을 수 있다)`,
        };
      }
      return { result: n === want ? 'match' : 'mismatch', observed, reason: `기대 ${want}개, 화면 ${n}개` };
    }
  }
}

/** 어느 관찰에서 찾아도 되는 종류 (나머지는 마지막 관찰 기준) */
const ANY_OBSERVATION = new Set<VerificationPoint['compare']>(['visible', 'text_exists', 'count', 'size_dp']);

/**
 * 검증 전에 화면이 자리 잡기를 기다린다: 트리가 바뀌지 않을 때까지 다시 관찰한다.
 * 바뀐 화면은 근거 목록 끝에 붙는다 (마지막 = 안정된 화면).
 */
export async function settle(
  env: AgentEnv,
  input: { caseId: string; evidence: Observation[]; nextIndex: number; tries?: number },
): Promise<Observation[]> {
  const out = [...input.evidence];
  let index = input.nextIndex;
  for (let i = 0; i < (input.tries ?? 3); i++) {
    await clockOf(env).sleep(env.settleMs ?? 500);
    const o = await observe(env, input.caseId, index++);
    if (o.treeText === out.at(-1)!.treeText) break;
    out.push(o);
  }
  return out;
}

/** evidence: 마지막 단계에서 본 화면들. 마지막 원소가 검증 시점(안정된) 화면 */
export async function verifyPoints(
  env: AgentEnv,
  input: { caseId: string; points: VerificationPoint[]; evidence: Observation[] },
): Promise<PointResult[]> {
  const { caseId, points, evidence } = input;
  const at = evidence.at(-1)!;
  const density = (await env.device.info()).density;
  const tree = points.filter((p) => p.method === 'tree');
  const vision = points.filter((p) => p.method === 'vision');
  const out = new Map<string, PointResult>();
  const base = (p: VerificationPoint) => ({
    pointId: p.id,
    expected: p.expected,
    method: p.method,
    evidence: at.screenshot,
  });

  if (tree.length) {
    const res = await env.llm.create(
      {
        model: MODELS.locator,
        max_tokens: 4096,
        output_config: { effort: 'low', format: outputFormat(LocateBatchOutput) },
        system: cachedSystem(LOCATOR_SYSTEM),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `검증 포인트:\n${pointList(tree)}` },
              ...evidence.flatMap((o) =>
                observationBlocks(
                  env,
                  { ...o, treeText: o.treeText.replace(/^e(\d+)\b/gm, `o${o.index}.e$1`) },
                  `[관찰 ${o.index}]${o === at ? ' (마지막)' : ''}`,
                  false,
                ),
              ),
            ],
          },
        ],
      },
      { role: 'locator', caseId },
    );
    const answers = new Map(parseOutput(res, LocateBatchOutput).points.map((a) => [a.point_id, a]));
    for (const p of tree) {
      const a = answers.get(p.id);
      if (!a) {
        out.set(p.id, { ...base(p), observed: '', result: 'unknown', reason: '요소 찾기 응답에 없음' });
        continue;
      }
      if (a.status === 'unclear') {
        out.set(p.id, { ...base(p), observed: '화면으로 알 수 없음', result: 'unknown', reason: a.reason });
        continue;
      }
      // 잠깐 뜨는 요소는 그 요소가 보인 관찰을 근거로 삼는다. 나머지는 마지막 관찰만 인정
      const anyObs = ANY_OBSERVATION.has(p.compare);
      // 참조 `o7.e6` → 관찰 7의 e6. 관찰 번호가 없으면(resource-id 등) 마지막 관찰
      const m = a.element_ref?.match(/^o(\d+)\.(.+)$/);
      const o = m ? evidence.find((x) => x.index === Number(m[1])) : at;
      if (a.status === 'found' && !o) {
        out.set(p.id, {
          ...base(p),
          observed: a.element_ref ?? '',
          result: 'unknown',
          reason: '없는 관찰의 요소를 골랐다',
        });
        continue;
      }
      if (a.status === 'found' && !anyObs && o !== at) {
        out.set(p.id, {
          ...base(p),
          observed: '',
          result: 'unknown',
          reason: '마지막 관찰이 아닌 화면을 근거로 골랐다',
        });
        continue;
      }
      const shown = o ?? at;
      const el = a.status === 'found' && a.element_ref ? findElement(shown.tree, m ? m[2]! : a.element_ref) : undefined;
      if (a.status === 'found' && !el) {
        out.set(p.id, {
          ...base(p),
          observed: a.element_ref ?? '',
          result: 'unknown',
          reason: '트리에 없는 요소를 골랐다',
        });
        continue;
      }
      const c = compareTree(p, el, density, shown.tree);
      out.set(p.id, {
        ...base(p),
        ...c,
        evidence: shown.screenshot,
        targetElement: el && elementName(el),
        targetBounds: el?.bounds,
        reason: `${c.reason} — ${a.reason}`,
      });
    }
  }

  if (vision.length) {
    // 잠깐 뜨는 요소(토스트)는 검증 시점 화면에서 이미 사라졌을 수 있다 — "보인다"류 포인트가 있으면
    // 마지막 단계를 수행하며 본 다른 화면(최근 2장)의 스크린샷도 함께 보낸다
    const earlier = vision.some((p) => p.compare === 'visible' || p.compare === 'text_exists' || p.compare === 'count')
      ? evidence
          .slice(0, -1)
          .filter((o, i, all) => o.treeText !== at.treeText && all.findIndex((x) => x.treeText === o.treeText) === i)
          .slice(-2)
      : [];
    const res = await env.llm.create(
      {
        model: MODELS.verifier,
        max_tokens: 4096,
        output_config: { effort: 'medium', format: outputFormat(VerifyBatchOutput) },
        system: cachedSystem(VERIFIER_SYSTEM),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `검증 포인트:\n${pointList(vision)}${earlier.length ? EARLIER_NOTE : ''}` },
              ...earlier.flatMap((o) => observationBlocks(env, o, `[앞선 화면 · 관찰 ${o.index}]`, true)),
              ...observationBlocks(env, at, '[검증 시점 화면]', true),
            ],
          },
        ],
      },
      { role: 'verifier', caseId },
    );
    const answers = new Map(parseOutput(res, VerifyBatchOutput).points.map((a) => [a.point_id, a]));
    for (const p of vision) {
      const a = answers.get(p.id);
      const el = a?.target_element ? findElement(at.tree, a.target_element) : undefined;
      out.set(
        p.id,
        a
          ? {
              ...base(p),
              result: a.result,
              observed: a.observed,
              reason: a.reason,
              targetElement: el ? elementName(el) : (a.target_element ?? undefined),
              targetBounds: el?.bounds,
            }
          : { ...base(p), observed: '', result: 'unknown', reason: 'Verifier 응답에 없음' },
      );
    }
  }

  return points.map((p) => out.get(p.id)!);
}
