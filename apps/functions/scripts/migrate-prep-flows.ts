/**
 * 준비 플로우를 프로젝트 공용 위치(`projects/{p}/prepFlows`)에서 QA 문서 버전별 사본
 * (`projects/{p}/qaDocs/{d}/prepFlows`)으로 옮긴다. 버전마다 그 버전 케이스가 참조하는 플로우를 복사하고,
 * 어느 케이스도 참조하지 않는 플로우는 최신 버전에 복사한다(`splitPrepFlowsByDoc`).
 *
 *   pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade              # 무엇을 할지만 보인다
 *   pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade --apply      # 버전별 사본을 만든다
 *   pnpm --filter @qcard/functions migrate-prep-flows --project qcard-d2ade --delete-old # 사본을 확인하고 옛 위치를 지운다
 *
 * 사람이 실행한다(`gcloud auth application-default login` 필요). 이미 있는 사본은 덮어쓰지 않아 여러 번 실행해도 된다.
 * QA 문서가 없는 프로젝트의 플로우는 옮길 곳이 없어 남겨 두고 알린다.
 */
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { splitPrepFlowsByDoc, type PrepFlow, type QADocument, type TestCase } from '@qcard/shared';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'delete-old': { type: 'boolean', default: false },
  },
});
if (!values.project) {
  console.error('사용법: migrate-prep-flows --project <Firebase 프로젝트 id> [--apply | --delete-old]');
  process.exit(1);
}

initializeApp({ projectId: values.project });
const db = getFirestore();
const byOrder = (docs: QueryDocumentSnapshot<DocumentData>[]) =>
  [...docs].sort((a, b) => ((a.get('_i') as number) ?? 0) - ((b.get('_i') as number) ?? 0));
const strip = <T>(d: QueryDocumentSnapshot<DocumentData>) => {
  const { _i: _, ...rest } = d.data();
  return rest as T;
};

let pending = 0;
for (const project of (await db.collection('projects').get()).docs) {
  const old = byOrder((await project.ref.collection('prepFlows').get()).docs);
  if (old.length === 0) continue;
  const flows = old.map((d) => strip<PrepFlow>(d));
  const docs = await Promise.all(
    (await project.ref.collection('qaDocs').get()).docs.map(async (d) => ({
      id: d.id,
      appVersion: (d.data() as QADocument).appVersion,
      createdAt: (d.data() as QADocument).createdAt,
      cases: (await d.ref.collection('cases').get()).docs.map((c) => c.data() as TestCase),
    })),
  );
  const split = splitPrepFlowsByDoc(flows, docs);
  console.log(`\n${project.id}: 공용 플로우 ${flows.length}개 · QA 문서 ${docs.length}개`);
  if (docs.length === 0) {
    console.log('  QA 문서가 없어 옮길 곳이 없다 — 남겨 둔다');
    pending++;
    continue;
  }

  let missing = 0;
  for (const d of docs) {
    const target = project.ref.collection('qaDocs').doc(d.id).collection('prepFlows');
    const existing = new Set((await target.get()).docs.map((x) => x.id));
    const copy = (split[d.id] ?? []).filter((f) => !existing.has(f.id));
    missing += copy.length;
    console.log(
      `  ${d.appVersion} (${d.id}): ${(split[d.id] ?? []).map((f) => f.id).join(', ') || '없음'}` +
        (copy.length ? ` — 새로 복사 ${copy.length}개` : ' — 사본 있음'),
    );
    if (values.apply && copy.length) {
      const batch = db.batch();
      const start = existing.size;
      copy.forEach((f, i) => batch.create(target.doc(f.id), { ...f, _i: start + i }));
      await batch.commit();
      missing -= copy.length;
    }
  }

  if (values['delete-old']) {
    if (missing > 0) {
      console.log(`  사본이 ${missing}개 빠져 있어 옛 위치를 지우지 않는다 — 먼저 --apply`);
      pending++;
      continue;
    }
    const batch = db.batch();
    old.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`  옛 위치의 플로우 ${old.length}개를 지웠다`);
  } else if (missing > 0 || !values.apply) {
    pending++;
  }
}

console.log(
  values.apply || values['delete-old']
    ? `\n끝. 남은 프로젝트 ${pending}개`
    : `\n미리 보기만 했다. 옮길 프로젝트 ${pending}개 — --apply로 복사한다`,
);
process.exit(0);
