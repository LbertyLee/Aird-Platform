import { bilingualResearchTerms } from './research-bilingual-terms';
import type { ResearchSourcePlan } from '../semantic/semantic.types';

const plan: ResearchSourcePlan = {
  status: 'ready',
  intentSummary: '查询人口数据',
  dataNeeds: ['人口总量'],
  allowDiscovery: false,
  sources: [],
  translations: [
    { zh: '人口总量', en: 'Total Population' },
    { zh: '新生人口', en: 'Births' },
    { zh: '移民人口', en: 'Net Migration' },
    { zh: '人均GDP', en: 'GDP per capita' },
  ],
};

describe('bilingualResearchTerms', () => {
  it.each([
    ['国家人口总量', 'Total Population'],
    ['年度人口总量数据', 'Total Population'],
    ['出生人口数', 'Births'],
    ['移民人口数', 'Net Migration'],
    [' total   population ', '人口总量'],
  ])('expands equivalent wording %s to %s', (term, translation) => {
    expect(bilingualResearchTerms([term], plan, 'metric')).toEqual(
      expect.arrayContaining([term, translation]),
    );
  });

  it.each(['人口增长率', '劳动年龄人口总量', '人均GDP增长率'])(
    'does not attach unrelated or more specific translations to %s',
    (term) => {
      expect(bilingualResearchTerms([term], plan, 'metric')).toEqual([term]);
    },
  );

  it.each([
    ['全国GDP数据', '国内生产总值', 'Gross Domestic Product'],
    ['人均GDP', '人均国内生产总值', 'GDP per capita'],
    ['年度GDP增速', '国内生产总值增长率', 'GDP growth rate'],
    ['消费者价格指数', '居民消费价格指数', 'Consumer Price Index'],
    ['生产者价格指数', '工业生产者出厂价格指数', 'Producer Price Index'],
    ['采购经理人指数', '采购经理指数', 'Purchasing Managers Index'],
    ['就业人数', '就业人口', 'Employed persons'],
    ['劳动力参与率', '劳动参与率', 'Labor force participation rate'],
    ['商品出口额', '货物出口额', 'Merchandise exports'],
    ['商品进口额', '货物进口额', 'Merchandise imports'],
    ['外国直接投资', '外商直接投资', 'Foreign direct investment'],
    ['社会消费品零售额', '社会消费品零售总额', 'Total retail sales of consumer goods'],
    ['居民人均可支配收入', '人均可支配收入', 'Per capita disposable income'],
    ['电力生产量', '发电量', 'Electricity generation'],
    ['电力消费量', '用电量', 'Electricity consumption'],
    ['CO2排放量', '二氧化碳排放量', 'Carbon dioxide emissions'],
  ])('links metric wording %s to translation %s', (term, zh, en) => {
    expect(bilingualResearchTerms([term], { ...plan, translations: [{ zh, en }] }, 'metric'))
      .toEqual(expect.arrayContaining([term, zh, en]));
  });

  it.each([
    ['GDP', '人均GDP'],
    ['GDP增速', '国内生产总值'],
    ['失业率', '城镇调查失业率'],
    ['发电量', '用电量'],
    ['货物出口额', '服务出口额'],
    ['二氧化碳排放量', '人均二氧化碳排放量'],
    ['CPI', '核心CPI'],
  ])('keeps distinct metric scopes %s and %s separate', (term, zh) => {
    expect(bilingualResearchTerms([term], { ...plan, translations: [{ zh, en: 'unrelated translation' }] }, 'metric'))
      .not.toContain('unrelated translation');
  });

  it('retains original terms when no translations are available', () => {
    expect(bilingualResearchTerms(['国家人口总量'])).toEqual(['国家人口总量']);
  });

  it('preserves scope in entity names', () => {
    expect(bilingualResearchTerms(['国家电网'], {
      ...plan, translations: [{ zh: '电网', en: 'power grid' }],
    })).toEqual(['国家电网']);
  });
});
