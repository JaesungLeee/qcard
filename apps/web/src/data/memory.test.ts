import { describe, expect, it, vi } from 'vitest';
import { GITHUB, PEOPLE } from '@qcard/fixtures';
import {
  ConflictError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  PermissionError,
  PrepFlowConflictError,
  RuleError,
} from './api';
import type { LocalRun } from './localRuns';
import { createMemoryApi, passRate } from './memory';

const DOC = { projectId: 'haru', docId: 'doc-130' };
const CYCLE = { projectId: 'haru', cycleId: 'cycle-130-1' };

describe('QA 문서 편집·승인', () => {
  it('rev가 맞으면 저장되고 rev가 오른다', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases[0]!;
    const saved = await api.updateCase(DOC, tc.tcId, { ...tc, title: '수정한 제목' }, tc.rev);
    expect(saved.rev).toBe(tc.rev + 1);
    expect(saved.title).toBe('수정한 제목');
  });

  it('다른 사람이 먼저 저장했으면 ConflictError로 최신 내용을 돌려준다 (F-QD-09)', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases[0]!;
    await api.updateCase(DOC, tc.tcId, { ...tc, title: '먼저 저장' }, tc.rev);
    const err = await api.updateCase(DOC, tc.tcId, { ...tc, title: '나중 저장' }, tc.rev).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).latest.title).toBe('먼저 저장');
  });

  it('승인된 케이스의 내용이 바뀌면 자동으로 미승인 (F-QD-10)', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases.find((c) => c.approval.status === 'approved')!;
    const same = await api.updateCase(DOC, tc.tcId, { ...tc }, tc.rev);
    expect(same.approval.status).toBe('approved');
    const changed = await api.updateCase(DOC, tc.tcId, { ...tc, priority: 'low' }, same.rev);
    expect(changed.approval.status).toBe('pending');
  });

  it('승인은 현재 내용 해시로 기록된다', async () => {
    const api = createMemoryApi();
    const tc = (await api.getQaDoc(DOC)).cases.find((c) => c.approval.status === 'pending')!;
    await api.setApproval(DOC, [tc.tcId], 'approved');
    const after = (await api.getQaDoc(DOC)).cases.find((c) => c.tcId === tc.tcId)!;
    expect(after.approval).toMatchObject({ status: 'approved', contentHash: tc.contentHash });
  });

  it('"현 스펙대로 진행"하면 그 질문에 묶인 보류 케이스가 미승인으로 풀린다 (F-QD-03)', async () => {
    const api = createMemoryApi();
    const doc = await api.getQaDoc(DOC);
    const q = doc.questions.find((x) => x.status === 'open')!;
    const held = doc.cases.filter((c) => q.caseIds.includes(c.tcId));
    expect(held.every((c) => c.approval.status === 'held')).toBe(true);
    await api.resolveQuestion(DOC, q.id, { kind: 'proceed' });
    const after = await api.getQaDoc(DOC);
    for (const c of held) expect(after.cases.find((x) => x.tcId === c.tcId)!.approval.status).toBe('pending');
  });
});

describe('사이클 판정', () => {
  it('사람이 확정하면 판정 주체·이력이 남는다 (F-RP-04)', async () => {
    const api = createMemoryApi();
    const { results } = await api.getCycle(CYCLE);
    const check = results.find((r) => r.verdict === 'check')!;
    const r = await api.confirmVerdict({
      ...CYCLE,
      tcId: check.tcId,
      deviceId: check.deviceId,
      verdict: 'pass',
      note: '확인함',
    });
    expect(r.decidedBy).toEqual({ kind: 'human', name: api.currentUser });
    expect(r.history.at(-1)).toMatchObject({ from: 'check', to: 'pass', by: api.currentUser });
  });

  it('수동 결과에 스크린샷을 첨부하고, 다시 확정할 때 남길 첨부만 남긴다 (F-RP-05)', async () => {
    const api = createMemoryApi();
    const r = (await api.getCycle(CYCLE)).results.find((x) => x.verdict === 'check')!;
    const at = { ...CYCLE, tcId: r.tcId, deviceId: r.deviceId };
    const png = { name: 'a.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]), w: 1080, h: 2340 };
    const first = await api.confirmVerdict({
      ...at,
      verdict: 'fail',
      actualSummary: '재현',
      attachments: { keep: [], add: [png, { ...png, name: 'b.png' }] },
    });
    expect(first.attachments).toEqual([
      { kind: 'url', url: 'data:image/png;base64,AQID', w: 1080, h: 2340 },
      { kind: 'url', url: 'data:image/png;base64,AQID', w: 1080, h: 2340 },
    ]);
    expect(first.history.at(-1)!.attachments).toBe(2);
    // 첨부를 주지 않으면 그대로, 주면 그 목록으로 바뀐다
    expect((await api.confirmVerdict({ ...at, verdict: 'fail', actualSummary: '재현' })).attachments).toHaveLength(2);
    const second = await api.confirmVerdict({ ...at, verdict: 'pass', attachments: { keep: [], add: [] } });
    expect(second.attachments).toBeUndefined();
    expect(second.history.at(-1)!.attachments).toBeUndefined();
  });

  it('첨부는 PNG·JPEG·WebP 이미지 5장, 한 장 10MB까지 (F-RP-05)', async () => {
    const api = createMemoryApi();
    const r = (await api.getCycle(CYCLE)).results.find((x) => x.verdict === 'check')!;
    const at = { ...CYCLE, tcId: r.tcId, deviceId: r.deviceId, verdict: 'pass' as const };
    const png = { name: 'a.png', type: 'image/png', bytes: new Uint8Array([1]) };
    await expect(
      api.confirmVerdict({ ...at, attachments: { keep: [], add: Array(MAX_ATTACHMENTS + 1).fill(png) } }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(
      api.confirmVerdict({ ...at, attachments: { keep: [], add: [{ ...png, type: 'image/gif' }] } }),
    ).rejects.toThrow('PNG·JPEG·WebP');
    const big = { ...png, bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) };
    await expect(api.confirmVerdict({ ...at, attachments: { keep: [], add: [big] } })).rejects.toThrow('10MB');
  });

  it('통과율은 N/T를 분모에서 뺀다', () => {
    expect(passRate({ pass: 8, fail: 1, blocked: 1, check: 0, nt: 90, na: 0 })).toBeCloseTo(0.8);
  });

  it('사이클을 만든 뒤 QA 문서 케이스를 고쳐도 사이클은 만들 때 내용으로 보인다 (F-CY-02)', async () => {
    const api = createMemoryApi();
    const cycle = await api.createCycle('haru', {
      name: '고정 확인',
      docId: DOC.docId,
      buildId: 'build-130',
      targets: [{ model: 'Pixel 8', osMajor: 15 }],
      serverEnv: 'stage',
    });
    const ref = { projectId: 'haru', cycleId: cycle.id };
    const before = (await api.getCycle(ref)).cases[0]!;
    await api.updateCase(DOC, before.tcId, { ...before, title: '사이클 뒤에 고친 제목' }, before.rev);
    const after = (await api.getCycle(ref)).cases[0]!;
    expect(after).toEqual(before);
    expect(after.contentHash).toBe(cycle.snapshot[0]!.contentHash);
  });

  it('구독하면 처음 내용과 판정 확정 뒤 내용을 받고, 끊으면 더 받지 않는다 (F-CY-05)', async () => {
    const api = createMemoryApi();
    const seen: string[] = [];
    const r = (await api.getCycle(CYCLE)).results.find((x) => x.verdict === 'check')!;
    const verdictOf = (d: { results: { tcId: string; deviceId: string; verdict: string }[] }) =>
      d.results.find((x) => x.tcId === r.tcId && x.deviceId === r.deviceId)!.verdict;
    const stop = api.watchCycle(CYCLE, (d) => seen.push(verdictOf(d)));
    await vi.waitFor(() => expect(seen).toEqual(['check']));
    await api.confirmVerdict({ ...CYCLE, tcId: r.tcId, deviceId: r.deviceId, verdict: 'fail', actualSummary: '재현' });
    await vi.waitFor(() => expect(seen).toEqual(['check', 'fail']));
    stop();
    await api.confirmVerdict({ ...CYCLE, tcId: r.tcId, deviceId: r.deviceId, verdict: 'pass' });
    await new Promise((res) => setTimeout(res, 20));
    expect(seen).toEqual(['check', 'fail']);
  });

  it('사이클 요약의 칸 수는 스냅샷 × 대상 디바이스', async () => {
    const api = createMemoryApi();
    const [summary] = await api.listCycles('haru');
    expect(summary!.total).toBe(summary!.cycle.snapshot.length * summary!.cycle.targets.length);
  });
});

describe('로컬 실행', () => {
  const run = (over: Partial<LocalRun> = {}): LocalRun => ({
    id: '2026-10-20T08-26-50-756Z',
    startedAt: '2026-10-20T08:26:50.756Z',
    finishedAt: '2026-10-20T08:28:30.000Z',
    device: { model: 'SM-S711N', osMajor: 16, size: { w: 1080, h: 2340 } },
    appPackage: 'com.example.harukong.qa',
    docId: DOC.docId,
    results: [
      {
        tcId: 'TC-ONBOARDING-001',
        deviceId: 'SM-S711N-16',
        verdict: 'pass',
        agentVerdict: 'pass',
        autoConfirmed: true,
        unmetConditions: [],
        attempts: 1,
        steps: [],
        points: [],
        history: [],
      },
    ],
    ...over,
  });

  it('실행 하나가 사이클 하나가 되고, 실행한 케이스·기기만 담는다', async () => {
    const api = createMemoryApi({ localRuns: async () => [run()] });
    const local = (await api.listCycles('haru')).find((s) => s.cycle.origin === 'local_run')!;
    expect(local.cycle.id).toBe('run-2026-10-20T08-26-50-756Z');
    expect(local.cycle.targets.map((t) => t.id)).toEqual(['SM-S711N-16']);
    expect(local).toMatchObject({ total: 1, done: 1, passRate: 1 });
    expect(local.build.packageName).toBe('com.example.harukong.qa');
    const detail = await api.getCycle({ projectId: 'haru', cycleId: local.cycle.id });
    expect(detail.cases.map((c) => c.tcId)).toEqual(['TC-ONBOARDING-001']);
  });

  it('로컬 실행 결과도 사람이 확정할 수 있다', async () => {
    const api = createMemoryApi({ localRuns: async () => [run()] });
    const r = await api.confirmVerdict({
      projectId: 'haru',
      cycleId: 'run-2026-10-20T08-26-50-756Z',
      tcId: 'TC-ONBOARDING-001',
      deviceId: 'SM-S711N-16',
      verdict: 'check',
      note: '다시 볼 것',
    });
    expect(r.history.at(-1)).toMatchObject({ from: 'pass', to: 'check' });
  });

  it('없는 QA 문서를 가리키는 실행은 건너뛰고, 한 번만 읽는다', async () => {
    let calls = 0;
    const api = createMemoryApi({
      localRuns: async () => {
        calls++;
        return [run({ docId: 'doc-x' })];
      },
    });
    await api.listCycles('haru');
    await api.listCycles('haru');
    expect(calls).toBe(1);
    expect((await api.listCycles('haru')).some((s) => s.cycle.origin === 'local_run')).toBe(false);
  });
});

describe('프로젝트·멤버·초대 (F-TM-09~13)', () => {
  const as = (user: string) => {
    const api = createMemoryApi();
    api.switchUser(user);
    return api;
  };

  it('내 프로젝트만 보이고, 멤버가 아니면 열 수 없다', async () => {
    const api = createMemoryApi();
    const mine = (await api.listMyProjects()).map((s) => `${s.project.id}:${s.role}`);
    expect(mine).toEqual(['haru:admin', 'widget:admin', 'roomie:viewer', 'old-poc:admin', 'moabook:admin']);
    await expect(api.getProject('atlas')).rejects.toBeInstanceOf(PermissionError);
  });

  it('누구나 프로젝트를 만들고 만든 사람이 Admin. 데이터 처리 안내 확인이 필요하다', async () => {
    const api = as(PEOPLE.planner);
    const input = { name: 'New App', appName: '새 앱', packageName: 'com.example.new', dataNoticeAck: false };
    await expect(api.createProject(input)).rejects.toBeInstanceOf(RuleError);
    const p = await api.createProject({ ...input, dataNoticeAck: true });
    expect(await api.myRole(p.id)).toBe('admin');
    await expect(api.createProject({ ...input, packageName: 'not a package', dataNoticeAck: true })).rejects.toThrow(
      'com.example.app',
    );
  });

  it('Admin이 0명이 되는 역할 변경·탈퇴는 막는다', async () => {
    const api = createMemoryApi();
    await expect(api.setMemberRole('haru', GITHUB[PEOPLE.lead]!, 'qa')).rejects.toBeInstanceOf(RuleError);
    await expect(api.leaveProject('haru')).rejects.toThrow('마지막 Admin');
    await api.setMemberRole('haru', GITHUB[PEOPLE.qa]!, 'admin');
    await api.leaveProject('haru');
    expect(await api.myRole('haru')).toBeUndefined();
  });

  it('혼자 남은 멤버는 탈퇴 대신 삭제해야 한다', async () => {
    await expect(createMemoryApi().leaveProject('widget')).rejects.toThrow('프로젝트를 삭제하세요');
  });

  it('Admin이 아니면 멤버·초대를 관리할 수 없다', async () => {
    const api = as(PEOPLE.qa);
    await expect(api.listInvitations('haru')).rejects.toBeInstanceOf(PermissionError);
    await expect(api.createInvitation('haru', { role: 'viewer' })).rejects.toBeInstanceOf(PermissionError);
    await expect(api.removeMember('haru', GITHUB[PEOPLE.planner]!)).rejects.toBeInstanceOf(PermissionError);
    await expect(api.deleteProject('haru', '하루콩')).rejects.toBeInstanceOf(PermissionError);
  });

  it('링크 초대는 데이터 처리 안내 확인 후 수락하면 멤버가 된다', async () => {
    const api = as(PEOPLE.planner);
    expect((await api.getInvitation('atlas-join')).state).toBe('pending');
    await expect(api.acceptInvitation('atlas-join', { dataNoticeAck: false })).rejects.toBeInstanceOf(RuleError);
    await api.acceptInvitation('atlas-join', { dataNoticeAck: true });
    expect(await api.myRole('atlas')).toBe('qa');
    expect((await api.getInvitation('atlas-join')).state).toBe('member');
  });

  it('만료·취소·다른 사람 앞 초대는 수락할 수 없다', async () => {
    // 박도윤은 하루콩 멤버라서 먼저 탈퇴시킨다
    const api = as(PEOPLE.planner);
    await api.leaveProject('haru');
    expect((await api.getInvitation('haru-expired')).state).toBe('expired');
    await expect(api.acceptInvitation('haru-expired', { dataNoticeAck: true })).rejects.toThrow('만료');
    expect((await api.getInvitation('haru-hyejin')).state).toBe('other-user');
    await expect(api.acceptInvitation('haru-hyejin', { dataNoticeAck: true })).rejects.toThrow('@hyejin-han');
    const admin = createMemoryApi();
    await admin.revokeInvitation('haru', 'inv-2');
    expect((await admin.getInvitation('haru-link')).state).toBe('revoked');
  });

  it('초대를 만들면 7일 뒤 만료되고, 이미 멤버·대기 중인 사용자명은 거부한다', async () => {
    const api = createMemoryApi();
    const inv = await api.createInvitation('haru', { role: 'qa', github: '@new-person' });
    expect(inv.github).toBe('new-person');
    const ttl = (Date.parse(inv.expiresAt) - Date.parse(inv.createdAt)) / 86_400_000;
    expect(Math.round(ttl)).toBe(7);
    await expect(api.createInvitation('haru', { role: 'qa', github: 'minji-kim' })).rejects.toThrow('이미 멤버');
    await expect(api.createInvitation('haru', { role: 'qa', github: 'new-person' })).rejects.toThrow('대기 중');
  });

  it('삭제는 이름을 입력해 확인하고, 30일 유예 동안 복구할 수 있다', async () => {
    const api = createMemoryApi();
    await expect(api.deleteProject('widget', '다른 이름')).rejects.toBeInstanceOf(RuleError);
    const p = await api.deleteProject('widget', '하루콩 위젯');
    expect(Math.round((Date.parse(p.purgeAt!) - Date.parse(p.deletedAt!)) / 86_400_000)).toBe(30);
    expect((await api.restoreProject('widget')).deletedAt).toBeUndefined();
  });
});

describe('웹에서 내 호스트로 Run 시작', () => {
  it('요청은 내 이름의 대기 작업이 되고, Viewer는 요청할 수 없다', async () => {
    const api = createMemoryApi();
    const job = await api.requestRun('haru', { cycleId: 'cycle-130-1', deviceId: 'pixel-8-16', tcIds: [] });
    expect(job).toMatchObject({
      kind: 'run_cycle',
      status: 'queued',
      requestedByName: PEOPLE.lead,
      input: { cycleId: 'cycle-130-1', deviceId: 'pixel-8-16' },
    });
    expect(job.input.tcIds).toBeUndefined();
    expect((await api.listJobs('haru'))[0]).toEqual(job);
    api.switchUser(PEOPLE.planner);
    await expect(api.requestRun('haru', { cycleId: 'cycle-130-1', deviceId: 'pixel-8-16' })).rejects.toBeInstanceOf(
      PermissionError,
    );
  });
});

describe('QA 문서 생성 요청 (PRD §5.2)', () => {
  const SPEC = `# 스펙 명세서: 샘플

### 유저 플로우 1 - 연다

| ID | 시나리오 | Given | When | Then | 관련 FR |
|---|---|---|---|---|---|
| TS-001 | 첫 화면 | 설치함 | 연다 | 보인다 | FR-001 |

- **FR-001**: 첫 화면을 보여 준다.
`;
  const files = [
    { path: 'specs/sample/spec.md', content: SPEC },
    { path: 'specs/sample/plan.md', content: '# 계획' },
  ];

  it('spec.md만 묶음으로 삼아 내 작업을 대기열에 넣는다', async () => {
    const api = createMemoryApi();
    const job = await api.requestQaDoc('haru', { appVersion: ' 1.4.1 ', files, prevDocId: 'doc-130' });
    expect(job).toMatchObject({
      status: 'queued',
      requestedBy: GITHUB[PEOPLE.lead],
      input: { appVersion: '1.4.1', prevDocId: 'doc-130' },
    });
    expect((await api.listJobs('haru'))[0]?.id).toBe(job.id);
  });

  it('Viewer·빈 폴더·버전 없음은 요청할 수 없다', async () => {
    const api = createMemoryApi({ currentUser: PEOPLE.planner });
    await expect(api.requestQaDoc('haru', { appVersion: '1.4.1', files })).rejects.toBeInstanceOf(PermissionError);
    api.switchUser(PEOPLE.lead);
    await expect(
      api.requestQaDoc('haru', { appVersion: '1.4.1', files: [{ path: 'a/plan.md', content: '' }] }),
    ).rejects.toBeInstanceOf(RuleError);
    await expect(api.requestQaDoc('haru', { appVersion: ' ', files })).rejects.toBeInstanceOf(RuleError);
  });

  it('일시정지한 작업은 요청자만 다시 시도한다', async () => {
    const api = createMemoryApi();
    // job-131은 최서준이 요청했다
    await expect(api.retryJob('haru', 'job-131')).rejects.toBeInstanceOf(PermissionError);
    api.switchUser(PEOPLE.dev);
    await api.retryJob('haru', 'job-131');
    const job = (await api.listJobs('haru')).find((j) => j.id === 'job-131');
    expect(job).toMatchObject({ status: 'queued' });
    expect(job).not.toHaveProperty('error');
    await expect(api.retryJob('haru', 'job-130')).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('준비 플로우 편집 (F-PF-01)', () => {
  const input = { name: '로그인 상태', kind: 'login' as const, check: '홈 탭이 보인다', steps: ['[로그인]'] };

  it('추가·편집하면 목록에 보이고 rev가 오른다. Viewer는 못 한다', async () => {
    const api = createMemoryApi();
    const made = await api.createPrepFlow('haru', input);
    expect(made).toMatchObject({ id: 'pf-login', rev: 1, updatedBy: PEOPLE.lead });
    const saved = await api.updatePrepFlow('haru', made.id, { ...input, steps: ['[로그인]', '홈 탭 확인'] }, 1);
    expect(saved.rev).toBe(2);
    expect((await api.listPrepFlows('haru')).at(-1)).toEqual(saved);
    expect(await api.listPrepFlows('moabook')).toEqual([]);
    api.switchUser(PEOPLE.planner);
    await expect(api.createPrepFlow('haru', input)).rejects.toBeInstanceOf(PermissionError);
    await expect(api.updatePrepFlow('haru', made.id, input, 2)).rejects.toBeInstanceOf(PermissionError);
  });

  it('스텝이 없으면 RuleError', async () => {
    const api = createMemoryApi();
    await expect(api.createPrepFlow('haru', { ...input, steps: [] })).rejects.toBeInstanceOf(RuleError);
  });

  it('다른 사람이 먼저 저장했으면 PrepFlowConflictError로 최신 내용을 돌려준다', async () => {
    const api = createMemoryApi();
    await api.updatePrepFlow('haru', 'pf-done', { ...input, kind: 'data_state', name: '먼저' }, 0);
    const err = await api.updatePrepFlow('haru', 'pf-done', { ...input, name: '나중' }, 0).catch((e) => e);
    expect(err).toBeInstanceOf(PrepFlowConflictError);
    expect((err as PrepFlowConflictError).latest).toMatchObject({ name: '먼저', rev: 1 });
  });

  it('케이스가 쓰는 플로우는 지우지 못하고, 안 쓰는 플로우는 지운다', async () => {
    const api = createMemoryApi();
    const uses = await api.listPrepFlowUses('haru');
    expect(uses['pf-clean']!.some((u) => u.in === 'doc' && u.docId === 'doc-120')).toBe(true);
    expect(uses['pf-clean']!.some((u) => u.in === 'cycle')).toBe(true);
    await expect(api.deletePrepFlow('haru', 'pf-clean')).rejects.toThrow(/케이스가 사용 중/);
    const made = await api.createPrepFlow('haru', input);
    api.switchUser(PEOPLE.planner);
    await expect(api.deletePrepFlow('haru', made.id)).rejects.toBeInstanceOf(PermissionError);
    api.switchUser(PEOPLE.lead);
    await api.deletePrepFlow('haru', made.id);
    expect((await api.listPrepFlows('haru')).map((f) => f.id)).not.toContain(made.id);
  });
});
