/** Domain-aware tokenizer for economic/social research documents. */
const ECONOMIC_TERMS = [
  '国内生产总值', '人均国内生产总值', '居民人均可支配收入', '全国居民人均可支配收入',
  '社会消费品零售总额', '固定资产投资', '固定资产投资完成额', '规模以上工业增加值',
  '社会融资规模', '社会融资规模存量', '货币供应量', '进出口总额', '出口总额', '进口总额',
  '消费者价格指数', '工业生产者出厂价格指数', '采购经理指数', '城镇调查失业率',
  '城镇新增就业', '财政收入', '财政支出', '一般公共预算收入', '一般公共预算支出',
  '居民消费价格', '房地产开发投资', '商品房销售面积', '商品房销售额', '研发经费投入',
  '研究与试验发展经费', '人口自然增长率', '出生率', '死亡率', '城镇化率', '老龄化率',
  '同比增长', '同比下降', '环比增长', '环比下降', '累计增长', '实际增长', '名义增长',
  '经济增长率', '高质量发展', '共同富裕', '区域协调发展', '产业结构', '就业结构',
  '第一产业', '第二产业', '第三产业', '国民经济', '社会保障', '基本养老保险', '基本医疗保险',
  '每十万人口', '万人', '亿元', '万亿元', '百分点', '个百分点',
];

const POPULATION_TERMS = [
  '常住人口', '户籍人口', '流动人口', '人口普查', '人口老龄化', '老年人口', '劳动年龄人口',
  '人口出生率', '人口死亡率', '人口自然增长率', '预期寿命', '性别比', '家庭户', '城镇人口',
  '乡村人口', '人口密度', '人口迁移', '人口流动', '生育率', '抚养比',
];

const EMPLOYMENT_TERMS = [
  '就业人数', '就业率', '调查失业率', '登记失业率', '城镇新增就业', '灵活就业', '高校毕业生就业',
  '劳动参与率', '平均工资', '工资性收入', '最低工资标准', '就业结构', '职业技能培训',
];

const FISCAL_TERMS = [
  '一般公共预算收入', '一般公共预算支出', '政府性基金预算', '国有资本经营预算', '社会保险基金预算',
  '税收收入', '非税收入', '中央财政', '地方财政', '财政赤字', '政府债务', '专项债券',
  '转移支付', '财政存量资金', '减税降费',
];

const FINANCE_TERMS = [
  '社会融资规模', '社会融资规模存量', '人民币贷款', '人民币存款', '金融机构贷款', '货币供应量',
  '广义货币', '狭义货币', '利率', '存款准备金率', '公开市场操作', '国债收益率', '汇率',
  '外汇储备', '金融市场', '资本市场', '股票市场', '债券市场', '普惠金融', '绿色金融',
];

const INDUSTRY_TERMS = [
  '新能源汽车', '先进制造业', '数字经济', '现代服务业', '战略性新兴产业', '高技术产业',
  '高技术制造业', '装备制造业', '电子信息制造业', '软件和信息技术服务业', '互联网经济',
  '平台经济', '人工智能产业', '集成电路产业', '生物医药产业', '新能源产业', '节能环保产业',
  '传统制造业', '生产性服务业', '生活性服务业', '现代农业', '乡村振兴', '房地产行业',
  '建筑业', '批发零售业', '住宿餐饮业', '交通运输业',
];

const REGIONAL_TERMS = [
  '长三角', '长江三角洲', '珠三角', '珠江三角洲', '京津冀', '粤港澳大湾区', '成渝地区双城经济圈',
  '长江经济带', '黄河流域', '东北地区', '东部地区', '中部地区', '西部地区', '东北振兴',
  '环渤海地区', '海峡西岸经济区', '城市群', '都市圈', '经济特区', '自贸区', '自贸试验区',
];

const TIME_TERMS = [
  '上半年', '下半年', '前三季度', '前四季度', '第一季度', '第二季度', '第三季度', '第四季度',
  '一季度', '二季度', '三季度', '四季度', '年度', '季度', '月度', '同比', '环比', '累计',
  '去年同期', '本期', '上期', '年初以来', '近五年', '近十年', '十四五', '十五五',
];

const BUILTIN_DOMAIN_TERMS = [...new Set([
  ...ECONOMIC_TERMS, ...POPULATION_TERMS, ...EMPLOYMENT_TERMS, ...FISCAL_TERMS,
  ...FINANCE_TERMS, ...INDUSTRY_TERMS, ...REGIONAL_TERMS, ...TIME_TERMS,
  '第一产业', '第二产业', '第三产业', '国民经济', '社会保障', '基本养老保险', '基本医疗保险',
  '每十万人口', '万人', '亿元', '万亿元', '百分点', '个百分点',
])].sort((a, b) => b.length - a.length);

const ALIASES: Record<string, string[]> = {
  gdp: ['国内生产总值'],
  cpi: ['居民消费价格指数', '居民消费价格'],
  ppi: ['工业生产者出厂价格指数'],
  pmi: ['采购经理指数'],
  gni: ['国民总收入'],
  fdi: ['外商直接投资'],
  rmb: ['人民币'],
  ai: ['人工智能'],
  'new-energy-vehicle': ['新能源汽车'],
  '三产': ['第三产业'],
  '二产': ['第二产业'],
  '一产': ['第一产业'],
};

export function tokenizeTerms(text: string): string[] {
  const normalized = text.toLowerCase().replace(/([a-z])(?=\d)|([0-9])(?=[a-z])/g, '$1$2 ').replace(/\s+/g, ' ').trim();
  const words = normalized.match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]+/g) ?? [];
  const externalEntries = DomainDictionary.load();
  const externalTerms = externalEntries.map((entry) => entry.term);
  const externalAliases = dictionaryAliases();
  const tokens = words.flatMap((word) => {
    const aliasTokens = [...(ALIASES[word] ?? []), ...(externalAliases[word] ?? [])];
    if (aliasTokens.length) return [word, ...aliasTokens];
    if (!/^[\u4e00-\u9fff]+$/.test(word)) return [word];
    const tokens: string[] = [];
    let rest = word;
    while (rest) {
    const term = [...externalTerms, ...BUILTIN_DOMAIN_TERMS].find((candidate) => rest.startsWith(candidate));
      if (term) {
        tokens.push(term);
        rest = rest.slice(term.length);
      } else {
        tokens.push(rest.length === 1 ? rest : rest.slice(0, 2));
        rest = rest.slice(rest.length === 1 ? 1 : 2);
      }
    }
    return tokens;
  });
  const normalizedTime = normalizeTimeExpressions(normalized);
  return [...new Set([...tokens, ...normalizedTime])];
}

function normalizeTimeExpressions(text: string): string[] {
  const tokens: string[] = [];
  const currentYear = new Date().getFullYear();
  if (text.includes('去年')) tokens.push(String(currentYear - 1), '上一年度');
  if (text.includes('今年') || text.includes('本年')) tokens.push(String(currentYear), '本年度');
  if (text.includes('前年')) tokens.push(String(currentYear - 2));
  const ranges = text.match(/(20\d{2})年?\s*[-至到]\s*(20\d{2})年?/g) ?? [];
  for (const range of ranges) {
    const years = range.match(/20\d{2}/g);
    if (years?.length === 2) tokens.push(`${years[0]}-${years[1]}`, ...years);
  }
  const years = text.match(/20\d{2}/g) ?? [];
  tokens.push(...years);
  if (text.includes('上半年')) tokens.push('1-6月', '前两季度');
  if (text.includes('下半年')) tokens.push('7-12月', '后两季度');
  if (text.includes('前三季度')) tokens.push('1-9月');
  return tokens;
}

export function tokenizeForSearch(text: string): string {
  return tokenizeTerms(text).join(' ');
}

export function dictionaryAliases(): Record<string, string[]> {
  return DomainDictionary.load().reduce<Record<string, string[]>>((result, entry) => {
    for (const alias of entry.aliases ?? []) {
      result[alias.toLowerCase()] = [entry.term, ...(result[alias.toLowerCase()] ?? [])];
    }
    return result;
  }, {});
}
import { DomainDictionary } from './domain-dictionary';
