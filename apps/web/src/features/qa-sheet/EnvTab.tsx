// ⑤ 환경 (PRD §5.10): 디바이스(모델·OS·해상도, 결과에 기록된 OS 빌드), 빌드, 테스트 계정(마스킹), 서버 환경
import {
  ContentBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  textClass,
  token,
} from '@qcard/ui';
import { fmtDateTime } from '../../components/format';
import { maskAccount } from './model';
import { Card, KV, Mono, SERVER_ENV_LABEL, TabBody } from './parts';
import type { SheetProps } from './QaSheetPage';

export function EnvTab({ d }: SheetProps) {
  const devices = d.cycle.targets.map((t) => {
    const rs = d.results.filter((r) => r.deviceId === t.id && r.verdict !== 'nt');
    return {
      t,
      osBuilds: [...new Set(rs.map((r) => r.osBuild).filter((x): x is string => Boolean(x)))],
      executors: [...new Set(rs.map((r) => r.executor).filter((x): x is string => Boolean(x)))],
      done: rs.length,
    };
  });
  return (
    <TabBody>
      <Card title="대상 디바이스">
        <div className="qs-scroll-x">
          <Table sx={{ minWidth: 760 }}>
            <TableHead>
              <TableRow>
                <TableHeadCell>대상</TableHeadCell>
                <TableHeadCell>모델</TableHeadCell>
                <TableHeadCell>OS</TableHeadCell>
                <TableHeadCell>해상도</TableHeadCell>
                <TableHeadCell>실제 OS 빌드 (결과 기록)</TableHeadCell>
                <TableHeadCell>실행자</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.map(({ t, osBuilds, executors, done }) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <span className={textClass('label1', 'medium')}>{t.label}</span>
                  </TableCell>
                  <TableCell>{t.model}</TableCell>
                  <TableCell>Android {t.osMajor}</TableCell>
                  <TableCell>
                    <span className="qs-big">{t.resolution}</span>
                  </TableCell>
                  <TableCell>
                    {osBuilds.length ? (
                      <span className="qs-stack" style={{ gap: token('space-2') }}>
                        {osBuilds.map((b) => (
                          <Mono key={b}>{b}</Mono>
                        ))}
                      </span>
                    ) : (
                      <span className="qs-faint">수행 결과 없음</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {executors.join(', ') || '—'}
                    {done > 0 && <span className={`${textClass('caption1')} qs-muted`}> · {done}칸</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <span className={`${textClass('caption1')} qs-muted`}>
          모델과 OS 메이저 버전이 같은 실제 디바이스는 같은 대상으로 봅니다. 정확한 OS 빌드·보안 패치는 결과마다
          기록됩니다.
        </span>
      </Card>

      <div className="qs-summary-grid">
        <Card title="빌드">
          <KV
            items={[
              ['앱 버전', d.build.version],
              ['빌드 번호', d.build.buildNumber],
              ['패키지', <Mono>{d.build.packageName}</Mono>],
              ['업로드', fmtDateTime(d.build.uploadedAt)],
              [
                '서명 인증서 SHA-1',
                <Mono className={textClass('label2')}>
                  <span style={{ wordBreak: 'break-all' }}>{d.build.signingSha1}</span>
                </Mono>,
              ],
            ]}
          />
        </Card>

        <div className="qs-stack">
          <Card title="서버 환경">
            <div className="qs-row">
              {(['dev', 'stage', 'prod'] as const).map((env) => (
                <ContentBadge color="neutral" key={env} size="medium" variant={env === d.cycle.serverEnv ? 'solid' : 'outlined'}>
                  {SERVER_ENV_LABEL[env]}
                  {env === d.cycle.serverEnv ? ' · 이 사이클' : ''}
                </ContentBadge>
              ))}
            </div>
          </Card>
          <Card title="테스트 계정">
            {d.cycle.accounts.length === 0 ? (
              <span className={`${textClass('label1')} qs-muted`}>없음</span>
            ) : (
              <ul className="qs-list">
                {d.cycle.accounts.map((a) => (
                  <li key={a.role}>
                    <span className={textClass('label1', 'medium')} style={{ minWidth: 96 }}>
                      {a.role}
                    </span>
                    <Mono className="qs-muted">{maskAccount(a.id)}</Mono>
                  </li>
                ))}
              </ul>
            )}
            <span className={`${textClass('caption1')} qs-faint`}>
              계정 ID는 마스킹해 표시합니다. 비밀번호는 저장하지 않습니다.
            </span>
          </Card>
        </div>
      </div>
    </TabBody>
  );
}
