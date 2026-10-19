/** 화면 표시용 날짜·숫자 형식. 시간대는 한국 시간으로 고정한다. */
const dateFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtPercent = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`;
export const fmtNumber = (n: number) => n.toLocaleString('ko-KR');
/** 영상 시점 (ms → m:ss) */
export const fmtTs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
