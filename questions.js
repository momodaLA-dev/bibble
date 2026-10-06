import { QUESTIONS as OLD_GENESIS } from "./genesis.js";
import { QUESTIONS as OLD_EXODUS } from "./exodus.js";
import { QUESTIONS as OLD_LEVITICUS } from "./leviticus.js";
import { QUESTIONS as OLD_NUMBERS } from "./numbers.js";
import { QUESTIONS as OLD_DEUTERONOMY } from "./deuteronomy.js";
import { QUESTIONS as OLD_JOSHUA } from "./joshua.js";
import { QUESTIONS as OLD_JUDGES } from "./judges.js";
import { QUESTIONS as OLD_RUTH } from "./ruth.js";
import { QUESTIONS as OLD_1_SAMUEL } from "./1-samuel.js";
import { QUESTIONS as OLD_2_SAMUEL } from "./2-samuel.js";
import { QUESTIONS as OLD_1_KINGS } from "./1-kings.js";
import { QUESTIONS as OLD_2_KINGS } from "./2-kings.js";
import { QUESTIONS as OLD_1_CHRONICLES } from "./1-chronicles.js";
import { QUESTIONS as OLD_2_CHRONICLES } from "./2-chronicles.js";
import { QUESTIONS as OLD_EZRA } from "./ezra.js";
import { QUESTIONS as OLD_NEHEMIAH } from "./nehemiah.js";
import { QUESTIONS as OLD_ESTHER } from "./esther.js";
import { QUESTIONS as OLD_JOB } from "./job.js";
import { QUESTIONS as OLD_PSALMS } from "./psalms.js";
import { QUESTIONS as OLD_PROVERBS } from "./proverbs.js";
import { QUESTIONS as OLD_ECCLESIASTES } from "./ecclesiastes.js";
import { QUESTIONS as OLD_SONG_OF_SONGS } from "./song-of-songs.js";
import { QUESTIONS as OLD_ISAIAH } from "./isaiah.js";
import { QUESTIONS as OLD_JEREMIAH } from "./jeremiah.js";
import { QUESTIONS as OLD_LAMENTATIONS } from "./lamentations.js";
import { QUESTIONS as OLD_EZEKIEL } from "./ezekiel.js";
import { QUESTIONS as OLD_DANIEL } from "./daniel.js";
import { QUESTIONS as OLD_HOSEA } from "./hosea.js";
import { QUESTIONS as OLD_JOEL } from "./joel.js";
import { QUESTIONS as OLD_AMOS } from "./amos.js";
import { QUESTIONS as OLD_OBADIAH } from "./obadiah.js";
import { QUESTIONS as OLD_JONAH } from "./jonah.js";
import { QUESTIONS as OLD_MICAH } from "./micah.js";
import { QUESTIONS as OLD_NAHUM } from "./nahum.js";
import { QUESTIONS as OLD_HABAKKUK } from "./habakkuk.js";
import { QUESTIONS as OLD_ZEPHANIAH } from "./zephaniah.js";
import { QUESTIONS as OLD_HAGGAI } from "./haggai.js";
import { QUESTIONS as OLD_ZECHARIAH } from "./zechariah.js";
import { QUESTIONS as OLD_MALACHI } from "./malachi.js";
import { QUESTIONS as NEW_MATTHEW } from "./matthew.js";
import { QUESTIONS as NEW_MARK } from "./mark.js";
import { QUESTIONS as NEW_LUKE } from "./luke.js";
import { QUESTIONS as NEW_JOHN } from "./john.js";
import { QUESTIONS as JESUS_LIFE } from "./jesus-life.js";
import { QUESTIONS as NEW_ACTS } from "./acts.js";
import { QUESTIONS as NEW_ROMANS } from "./romans.js";
import { QUESTIONS as NEW_1_CORINTHIANS } from "./1-corinthians.js";
import { QUESTIONS as NEW_2_CORINTHIANS } from "./2-corinthians.js";
import { QUESTIONS as NEW_GALATIANS } from "./galatians.js";
import { QUESTIONS as NEW_EPHESIANS } from "./ephesians.js";
import { QUESTIONS as NEW_PHILIPPIANS } from "./philippians.js";
import { QUESTIONS as NEW_COLOSSIANS } from "./colossians.js";
import { QUESTIONS as NEW_1_THESSALONIANS } from "./1-thessalonians.js";
import { QUESTIONS as NEW_2_THESSALONIANS } from "./2-thessalonians.js";
import { QUESTIONS as NEW_1_TIMOTHY } from "./1-timothy.js";
import { QUESTIONS as NEW_2_TIMOTHY } from "./2-timothy.js";
import { QUESTIONS as NEW_TITUS } from "./titus.js";
import { QUESTIONS as NEW_PHILEMON } from "./philemon.js";
import { QUESTIONS as NEW_HEBREWS } from "./hebrews.js";
import { QUESTIONS as NEW_JAMES } from "./james.js";
import { QUESTIONS as NEW_1_PETER } from "./1-peter.js";
import { QUESTIONS as NEW_2_PETER } from "./2-peter.js";
import { QUESTIONS as NEW_1_JOHN } from "./1-john.js";
import { QUESTIONS as NEW_2_JOHN } from "./2-john.js";
import { QUESTIONS as NEW_3_JOHN } from "./3-john.js";
import { QUESTIONS as NEW_JUDE } from "./jude.js";
import { QUESTIONS as NEW_REVELATION } from "./revelation.js";

export const OLD_TESTAMENT = [
  "創世記",
  "出埃及記",
  "利未記",
  "民數記",
  "申命記",
  "約書亞記",
  "士師記",
  "路得記",
  "撒母耳記上",
  "撒母耳記下",
  "列王紀上",
  "列王紀下",
  "歷代志上",
  "歷代志下",
  "以斯拉記",
  "尼希米記",
  "以斯帖記",
  "約伯記",
  "詩篇",
  "箴言",
  "傳道書",
  "雅歌",
  "以賽亞書",
  "耶利米書",
  "耶利米哀歌",
  "以西結書",
  "但以理書",
  "何西阿書",
  "約珥書",
  "阿摩司書",
  "俄巴底亞書",
  "約拿書",
  "彌迦書",
  "那鴻書",
  "哈巴谷書",
  "西番雅書",
  "哈該書",
  "撒迦利亞書",
  "瑪拉基書"
];
export const NEW_TESTAMENT = [
  "馬太福音",
  "馬可福音",
  "路加福音",
  "約翰福音",
  "耶穌生平（四福音）",
  "使徒行傳",
  "羅馬書",
  "哥林多前書",
  "哥林多後書",
  "加拉太書",
  "以弗所書",
  "腓立比書",
  "歌羅西書",
  "帖撒羅尼迦前書",
  "帖撒羅尼迦後書",
  "提摩太前書",
  "提摩太後書",
  "提多書",
  "腓利門書",
  "希伯來書",
  "雅各書",
  "彼得前書",
  "彼得後書",
  "約翰一書",
  "約翰二書",
  "約翰三書",
  "猶大書",
  "啟示錄"
];
export const ALL_BOOKS = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

export const BIBLE_QUESTIONS = [
  ...OLD_GENESIS,
  ...OLD_EXODUS,
  ...OLD_LEVITICUS,
  ...OLD_NUMBERS,
  ...OLD_DEUTERONOMY,
  ...OLD_JOSHUA,
  ...OLD_JUDGES,
  ...OLD_RUTH,
  ...OLD_1_SAMUEL,
  ...OLD_2_SAMUEL,
  ...OLD_1_KINGS,
  ...OLD_2_KINGS,
  ...OLD_1_CHRONICLES,
  ...OLD_2_CHRONICLES,
  ...OLD_EZRA,
  ...OLD_NEHEMIAH,
  ...OLD_ESTHER,
  ...OLD_JOB,
  ...OLD_PSALMS,
  ...OLD_PROVERBS,
  ...OLD_ECCLESIASTES,
  ...OLD_SONG_OF_SONGS,
  ...OLD_ISAIAH,
  ...OLD_JEREMIAH,
  ...OLD_LAMENTATIONS,
  ...OLD_EZEKIEL,
  ...OLD_DANIEL,
  ...OLD_HOSEA,
  ...OLD_JOEL,
  ...OLD_AMOS,
  ...OLD_OBADIAH,
  ...OLD_JONAH,
  ...OLD_MICAH,
  ...OLD_NAHUM,
  ...OLD_HABAKKUK,
  ...OLD_ZEPHANIAH,
  ...OLD_HAGGAI,
  ...OLD_ZECHARIAH,
  ...OLD_MALACHI,
  ...NEW_MATTHEW,
  ...NEW_MARK,
  ...NEW_LUKE,
  ...NEW_JOHN,
  ...JESUS_LIFE,
  ...NEW_ACTS,
  ...NEW_ROMANS,
  ...NEW_1_CORINTHIANS,
  ...NEW_2_CORINTHIANS,
  ...NEW_GALATIANS,
  ...NEW_EPHESIANS,
  ...NEW_PHILIPPIANS,
  ...NEW_COLOSSIANS,
  ...NEW_1_THESSALONIANS,
  ...NEW_2_THESSALONIANS,
  ...NEW_1_TIMOTHY,
  ...NEW_2_TIMOTHY,
  ...NEW_TITUS,
  ...NEW_PHILEMON,
  ...NEW_HEBREWS,
  ...NEW_JAMES,
  ...NEW_1_PETER,
  ...NEW_2_PETER,
  ...NEW_1_JOHN,
  ...NEW_2_JOHN,
  ...NEW_3_JOHN,
  ...NEW_JUDE,
  ...NEW_REVELATION,
];

export const DIFFICULTY_LABELS = { easy:"🟢 簡單", normal:"🟡 普通", hard:"🔴 困難", heaven:"👼 上天堂" };
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
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  return pool.slice(0,Math.min(count,pool.length)).map((q,i)=>({...q,id:i}));
}
