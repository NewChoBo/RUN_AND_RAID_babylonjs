import type { ORIGINAL_HERO_IDS, RaidHero } from '../../game/raid/heroes/hero-id.ts';

type SkillSlots = readonly [string, string, string, string];

type OfficialGuide = {
  article: number;
  passive: string;
  skills: SkillSlots;
  shieldMode?: SkillSlots;
};

// Korean names follow the skill tables in the original cafe, including the two modes.
export const officialGuides: Partial<Record<RaidHero, OfficialGuide>> = {
  hammer: {
    article: 5734,
    passive: '굳건함',
    skills: ['분쇄', '도약공격', '소용돌이', '천벌의망치'],
  },
  longshot: {
    article: 5735,
    passive: '공중도약',
    skills: ['다발사격', '화살비', '회전사격', '관통사격'],
  },
  flare: {
    article: 5736,
    passive: '발화',
    skills: ['화염구', '화염 폭발', '점화', '불기둥'],
  },
  alice: {
    article: 5737,
    passive: '신성한오라',
    skills: ['신의분노', '신성한서약', '신성한심판', '신성한구'],
  },
  hof: {
    article: 5738,
    passive: '제트엔진',
    skills: ['연발포탑', '냉기포탑', '전류포탑', '원격폭발'],
  },
  kali: {
    article: 5739,
    passive: '그림자추적',
    skills: ['그림자일격', '중독', '그림자밟기', '어둠의칼날'],
  },
  kaiken: {
    article: 5740,
    passive: '월광',
    skills: ['반월', '상월', '만월', '쾌속풍월참'],
  },
  abyss: {
    article: 5741,
    passive: '제물',
    skills: ['어둠의 구체', '왜곡', '심연 속으로', '공허의 구체'],
  },
  froze: {
    article: 5742,
    passive: '동상',
    skills: ['얼음 창', '얼음 점멸', '얼음 방패', '얼어붙은 대지'],
  },
  magnus: {
    article: 5743,
    passive: '모드 변환',
    skills: ['충격파', '자기장', '격노', '전투 모드'],
    shieldMode: ['돌격전차', '도발', '전투의외침', '방패 모드'],
  },
  swift: {
    article: 5744,
    passive: '복수',
    skills: ['십자 가르기', '찌르기', '추적의 표식', '춤추는 칼날'],
  },
  rildin: {
    article: 5745,
    passive: '케이론식 검술',
    skills: ['연속 베기', '반격', '진격', '해방된 검'],
  },
  jade: {
    article: 5746,
    passive: '번개 친화력',
    skills: ['번개 구', '전격 폭발', '연쇄 번개', '번개 부름'],
  },
  theresa: {
    article: 5747,
    passive: '신성 갑옷',
    skills: ['치유의 외침', '방패돌격', '수호의 일격', '신성한 부름'],
  },
  drizz: {
    article: 17324,
    passive: '어둠가르기',
    skills: ['어둠손아귀', '올려치기', '지면강타', '파멸의 주먹'],
  },
  vallet: {
    article: 22713,
    passive: '사격광',
    skills: ['폭발탄환', '산탄사격', '비상탈출', '저격'],
  },
  freesia: {
    article: 36547,
    passive: '꽃의 은총',
    skills: ['꽃가루 폭탄', '꽃가루 바람', '숨바꼭질', '거미줄덫'],
  },
} satisfies Record<(typeof ORIGINAL_HERO_IDS)[number], OfficialGuide>;
