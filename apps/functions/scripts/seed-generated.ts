/**
 * QA Doc Generator 결과(`pnpm --filter @qcard/qadoc generate`의 JSON)를 실행 중인 에뮬레이터에 별도 프로젝트로 넣는다.
 * 생성 품질을 웹 검토 화면에서 보기 위한 개발용 명령. 기존 시드는 지우지 않는다(같은 프로젝트만 덮어쓴다).
 *
 *   pnpm --filter @qcard/functions seed-generated <결과.json…> [--project haru-gen] [--name "하루콩 생성 결과"]
 *     결과 파일은 버전 순서대로 준다 (이전 버전 먼저). 준비 플로우는 마지막 파일의 것을 쓴다.
 *     멤버는 fixture 하루콩 프로젝트와 같다.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createFixtureDb } from '@qcard/fixtures';
import type { PrepFlow, Project, QADocument } from '@qcard/shared';

const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):/.test(host)) {
  console.error(`에뮬레이터에서만 실행합니다: ${host}`);
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = host;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { project: { type: 'string', default: 'haru-gen' }, name: { type: 'string', default: '하루콩 생성 결과' } },
});
if (!positionals.length) {
  console.error('사용법: seed-generated <결과.json…> [--project <id>]');
  process.exit(1);
}

type Generated = { doc: QADocument; prepFlows: PrepFlow[] };
const results = await Promise.all(positionals.map(async (p) => JSON.parse(await readFile(p, 'utf8')) as Generated));

initializeApp({ projectId: 'demo-qcard' });
const db = getFirestore();
const fixture = createFixtureDb();
const haru = fixture.projects.find((p) => p.id === 'haru')!;
const projectId = values.project;

const docs: [string, unknown][] = [];
const put = (path: string, data: unknown) => docs.push([path, JSON.parse(JSON.stringify(data))]);
const project: Project = { ...haru, id: projectId, name: values.name, createdAt: new Date().toISOString() };
put(`projects/${projectId}`, project);
for (const m of fixture.members.filter((m) => m.projectId === 'haru')) {
  put(`projects/${projectId}/members/${m.uid}`, { ...m, projectId });
}
const docId = (d: QADocument) => `doc-${d.appVersion}`;
results.forEach(({ doc }, i) => {
  const { cases, ...meta } = doc;
  const prev = i > 0 ? docId(results[i - 1]!.doc) : undefined;
  const base = `projects/${projectId}/qaDocs/${docId(doc)}`;
  put(base, { ...meta, id: docId(doc), projectId, ...(prev ? { prevDocId: prev } : {}) });
  cases.forEach((c, j) => put(`${base}/cases/${c.tcId}`, { ...c, _i: j }));
});
results.at(-1)!.prepFlows.forEach((f, i) => put(`projects/${projectId}/prepFlows/${f.id}`, { ...f, _i: i }));

// 같은 프로젝트의 이전 시드는 지운다
await db.recursiveDelete(db.doc(`projects/${projectId}`));
for (let i = 0; i < docs.length; i += 450) {
  const batch = db.batch();
  for (const [path, data] of docs.slice(i, i + 450)) batch.set(db.doc(path), data as Record<string, unknown>);
  await batch.commit();
}
console.log(
  `시드 완료: 프로젝트 ${projectId} · QA 문서 ${results.map((r) => r.doc.appVersion).join(', ')} · 문서 ${docs.length}개`,
);
process.exit(0);
