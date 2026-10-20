import { describe, expect, it } from 'vitest';
import { center, findElement, formatTree, parseUiTree, pxToDp } from './tree';

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.harukong" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
  <node index="0" text="닉네임 설정" resource-id="profile_title" class="android.widget.TextView" package="com.example.harukong" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[300,110][780,210]" />
  <node index="1" text="" resource-id="com.example.harukong:id/nickname" class="android.widget.EditText" package="com.example.harukong" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="true" scrollable="false" long-clickable="true" password="false" selected="false" bounds="[60,720][1020,870]" />
  <node index="2" text="" resource-id="" class="android.view.View" package="com.example.harukong" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,900][1080,1000]">
    <node index="0" text="&quot;여기&quot; &amp; 저기 &#x2764;" resource-id="" class="android.widget.TextView" package="com.example.harukong" content-desc="" checkable="true" checked="true" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,900][1020,1000]" />
  </node>
  <node index="3" text="저장" resource-id="profile_save" class="android.widget.Button" package="com.example.harukong" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[60,2160][1020,2320]" />
</node>
</hierarchy>`;

describe('parseUiTree', () => {
  const tree = parseUiTree(XML);

  it('문서 순서대로 ref를 매기고 깊이·부모를 기록한다', () => {
    expect(tree.map((e) => e.ref)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
    expect(tree.map((e) => e.depth)).toEqual([0, 1, 1, 1, 2, 1]);
    expect(tree[4]!.parent).toBe('e3');
    expect(tree[5]!.parent).toBe('e0');
  });

  it('bounds를 x·y·w·h로, 속성을 불리언으로 바꾼다', () => {
    expect(tree[5]).toMatchObject({
      text: '저장',
      resourceId: 'profile_save',
      bounds: { x: 60, y: 2160, w: 960, h: 160 },
      clickable: true,
      enabled: false,
    });
  });

  it('resource-id의 패키지 접두어를 떼고 XML 엔티티를 푼다', () => {
    expect(tree[2]!.resourceId).toBe('nickname');
    expect(tree[4]!.text).toBe('"여기" & 저기 ❤');
    expect(tree[4]!.checked).toBe(true);
    expect(tree[1]!.checked).toBeUndefined();
  });

  it('번호나 resource-id로 찾는다', () => {
    expect(findElement(tree, 'e5')?.text).toBe('저장');
    expect(findElement(tree, 'profile_save')?.ref).toBe('e5');
    expect(findElement(tree, 'nope')).toBeUndefined();
    expect(center(tree[5]!.bounds)).toEqual([540, 2240]);
  });
});

describe('formatTree', () => {
  it('의미 있는 요소만 한 줄씩, 상태 표시와 함께', () => {
    expect(formatTree(parseUiTree(XML)).split('\n')).toEqual([
      'e1 TextView "닉네임 설정" id=profile_title [300,110 480x100]',
      'e2 EditText id=nickname [60,720 960x150] clickable focused',
      'e4 TextView "\\"여기\\" & 저기 ❤" [60,900 960x100] checked',
      'e5 Button "저장" id=profile_save [60,2160 960x160] clickable disabled',
    ]);
  });

  it('글자 없는 클릭 요소는 자식 텍스트를 라벨로 보여 준다 (Compose 버튼)', () => {
    const xml = `<node class="android.view.View" clickable="true" enabled="false" bounds="[557,2020][1024,2155]">
      <node text="저장" class="android.widget.TextView" bounds="[751,2059][831,2115]" />
    </node>`;
    expect(formatTree(parseUiTree(xml)).split('\n')).toEqual([
      'e0 View label="저장" [557,2020 467x135] clickable disabled',
      'e1 TextView "저장" [751,2059 80x56]',
    ]);
  });

  it('비밀번호 필드 값은 가린다', () => {
    const xml =
      '<node text="hunter2" class="android.widget.EditText" password="true" clickable="true" bounds="[0,0][10,10]" />';
    expect(formatTree(parseUiTree(xml))).toContain('"••••"');
  });
});

it('px → dp는 dpi 기준 (420dpi에서 160px = 약 61dp)', () => {
  expect(pxToDp(420, 420)).toBe(160);
  expect(pxToDp(160, 420)).toBeCloseTo(60.95, 1);
});
