export const OLD_TESTAMENT = [
  "創世記","出埃及記","利未記","民數記","申命記","約書亞記","士師記","路得記","撒母耳記上","撒母耳記下",
  "列王紀上","列王紀下","歷代志上","歷代志下","以斯拉記","尼希米記","以斯帖記","約伯記","詩篇","箴言",
  "傳道書","雅歌","以賽亞書","耶利米書","耶利米哀歌","以西結書","但以理書","何西阿書","約珥書","阿摩司書",
  "俄巴底亞書","約拿書","彌迦書","那鴻書","哈巴谷書","西番雅書","哈該書","撒迦利亞書","瑪拉基書"
];
export const NEW_TESTAMENT = [
  "馬太福音","馬可福音","路加福音","約翰福音","使徒行傳","羅馬書","哥林多前書","哥林多後書","加拉太書","以弗所書",
  "腓立比書","歌羅西書","帖撒羅尼迦前書","帖撒羅尼迦後書","提摩太前書","提摩太後書","提多書","腓利門書","希伯來書","雅各書",
  "彼得前書","彼得後書","約翰一書","約翰二書","約翰三書","猶大書","啟示錄"
];
export const ALL_BOOKS = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

// 重要：只把能由《和合本》經文本身核對的題目放進這裡。
// 本版刻意不預填任何網路、解經書、其他譯本或模型記憶中的題目。
// 建議欄位：testament, book, chapter, verse, difficulty, question, choices, answer, reference, explanation
export const BIBLE_QUESTIONS = [
  {
    testament:"old", book:"詩篇", chapter:23, verse:"1", difficulty:"easy",
    question:"「耶和華是我的牧者，我必不致缺乏。」出自詩篇哪一篇？",
    choices:["詩篇 1 篇","詩篇 23 篇","詩篇 91 篇","詩篇 121 篇"],
    answer:"B", reference:"詩篇 23:1",
    explanation:"這是詩篇 23 篇開頭最熟悉的經文之一。"
  },
  {
    testament:"old", book:"詩篇", chapter:119, verse:"全篇", difficulty:"easy",
    question:"詩篇 119 篇主要反覆強調的是什麼？",
    choices:["戰爭與得勝","神的律法、話語與命令","聖殿的建造","以色列王的家譜"],
    answer:"B", reference:"詩篇 119 篇",
    explanation:"詩篇 119 篇反覆提到律法、法度、訓詞、命令、典章與話語。"
  },
  {
    testament:"old", book:"詩篇", chapter:1, verse:"3", difficulty:"easy",
    question:"詩篇第一篇把喜愛耶和華律法的人比喻成什麼？",
    choices:["栽在溪水旁的樹","山上的城","曠野中的磐石","天上的星"],
    answer:"A", reference:"詩篇 1:3",
    explanation:"經文以栽在溪水旁、按時候結果子的樹來比喻這樣的人。"
  },
  {
    testament:"old", book:"詩篇", chapter:121, verse:"1", difficulty:"easy",
    question:"「我要向山舉目；我的幫助從何而來？」出自哪一篇詩篇？",
    choices:["詩篇 23 篇","詩篇 46 篇","詩篇 121 篇","詩篇 150 篇"],
    answer:"C", reference:"詩篇 121:1",
    explanation:"這句話出現在詩篇 121 篇開頭。"
  },
  {
    testament:"old", book:"詩篇", chapter:150, verse:"全篇", difficulty:"easy",
    question:"詩篇最後一篇，也就是詩篇 150 篇，最主要是在呼籲人做什麼？",
    choices:["禁食禱告","讚美耶和華","建造城牆","離開埃及"],
    answer:"B", reference:"詩篇 150 篇",
    explanation:"詩篇 150 篇以讚美耶和華為核心，並列出多種樂器與讚美方式。"
  }
];

export const DIFFICULTY_LABELS = {
  easy:"🟢 簡單", normal:"🟡 普通", hard:"🔴 困難", heaven:"👼 上天堂"
};
export const DIFFICULTY_POINTS = { easy:100, normal:200, hard:300, heaven:500 };

export function booksFor(testament){
  if(testament === "old") return OLD_TESTAMENT;
  if(testament === "new") return NEW_TESTAMENT;
  return ALL_BOOKS;
}

export function filterQuestions({testament="all", book="all", difficulty="easy"}={}){
  return BIBLE_QUESTIONS.filter(q =>
    (testament === "all" || q.testament === testament) &&
    (book === "all" || q.book === book) &&
    q.difficulty === difficulty
  );
}

export function buildQuestionSet(settings,count){
  const pool = [...filterQuestions(settings)];
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  return pool.slice(0,Math.min(count,pool.length)).map((q,i)=>({...q,id:i}));
}
