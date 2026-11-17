import { inferQueryRegions } from './query-regions';

describe('query region constraints', () => {
  it.each([
    ['泉州近10年来经济报告以及未来10年预测', ['泉州']],
    ['中国福建省泉州市GDP', ['泉州']],
    ['泉州和厦门经济比较', ['厦门', '泉州']],
    ['中国四川省近5年GDP', ['四川']],
    ['北京近十年经济报告', ['北京']],
    ['全国近10年来经济报告', []],
  ])('recognizes localities in %s', (query, expected) => {
    expect(inferQueryRegions(query).sort()).toEqual(expected.sort());
  });
});
