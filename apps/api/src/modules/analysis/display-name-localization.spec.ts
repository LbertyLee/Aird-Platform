import {
  collectDisplayNames,
  localizeDisplayNames,
} from './display-name-localization';

it('translates labels across regions, metrics, institutions and titles without changing values or identifiers', () => {
  const input = {
    queryDimensions: { entities: ['Bavaria'] },
    sources: [{ title: 'International Federation of Robotics' }],
    availableIndicators: [
      {
        name: 'Industrial robot density',
        code: 'robot_density',
        unit: 'robots/10000 workers',
      },
    ],
    rows: [
      {
        entity: 'Bavaria',
        organization: 'International Federation of Robotics',
        value: 100,
        indicatorCode: 'robot_density',
        evidence: 'Industrial robot density 100',
        url: 'https://example.org',
      },
    ],
  };
  const translations = {
    Bavaria: '巴伐利亚',
    'International Federation of Robotics': '国际机器人联合会',
    'Industrial robot density': '工业机器人密度',
  };
  expect(collectDisplayNames(input)).toEqual(
    expect.arrayContaining(Object.keys(translations)),
  );
  const result = localizeDisplayNames(input, translations);
  expect(result.queryDimensions.entities).toEqual(['巴伐利亚']);
  expect(result.sources[0].title).toBe('国际机器人联合会');
  expect(result.availableIndicators[0]).toMatchObject({
    name: '工业机器人密度',
    code: 'robot_density',
    unit: 'robots/10000 workers',
  });
  expect(result.rows[0]).toMatchObject({
    entity: '巴伐利亚',
    value: 100,
    indicatorCode: 'robot_density',
    evidence: 'Industrial robot density 100',
    url: 'https://example.org',
  });
  expect(input.rows[0].entity).toBe('Bavaria');
});
